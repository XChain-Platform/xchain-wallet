// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum AlertsPresenter {
    struct Value: Codable, Equatable {
        let key: String?
        let text: String?
        let at: Int64?

        init(key: String? = nil, text: String? = nil, at: Int64? = nil) {
            self.key = key
            self.text = text
            self.at = at
        }
    }

    struct Line: Codable, Equatable {
        let label: Value?
        let value: Value

        private enum CodingKeys: String, CodingKey {
            case label
            case value
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(label, forKey: .label)
            try container.encode(value, forKey: .value)
        }
    }

    struct RequestModel: Codable, Equatable {
        let pinned: Value
        let lines: [Line]
    }

    static func inbox(_ items: [SnapshotInboxItem]) -> [SnapshotInboxItem] {
        AlertsRules.newestFirst(items, at: \SnapshotInboxItem.at)
    }

    static func detailBody(_ item: SnapshotInboxItem) -> String? {
        AlertsRules.detailBody(item.body)
    }

    static func request(_ request: Request, now: Int64) -> RequestModel {
        var lines = [
            Line(
                label: Value(key: "w4.requestSentence"),
                value: Value(text: request.sentence)
            ),
            Line(
                label: Value(key: "w4.requestAmount"),
                value: Value(text: request.amountText)
            ),
        ]

        if let expiresAt = request.expiresAt {
            lines.append(AlertsRules.isExpired(expiresAt: expiresAt, now: now)
                ? Line(label: nil, value: Value(key: "w4.requestExpired"))
                : Line(
                    label: Value(key: "w4.requestExpiry"),
                    value: Value(at: expiresAt)
                ))
        }

        return RequestModel(pinned: Value(key: "w1.requestWaiting"), lines: lines)
    }
}
