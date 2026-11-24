// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct AlertDetailScreen: View {
    let item: SnapshotInboxItem?
    let request: Request?
    let now: Int64
    let onOpenOnPhone: () -> Void

    init(
        item: SnapshotInboxItem,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.item = item
        request = nil
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    init(
        request: Request,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        onOpenOnPhone: @escaping () -> Void
    ) {
        item = nil
        self.request = request
        self.now = now
        self.onOpenOnPhone = onOpenOnPhone
    }

    var familySymbol: String {
        AlertFamilyIcon.symbol(family: item?.family ?? request?.kind.rawValue ?? "")
    }

    var detailBody: String? { item.flatMap { AlertsRules.detailBody($0.body) } }
    var alertTime: (key: String, n: Int)? {
        item.map { RelativeTimeText.alertKey(at: $0.at, now: now) }
    }
    var requestExpired: Bool { AlertsRules.isExpired(expiresAt: request?.expiresAt, now: now) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: familySymbol).font(.title2).foregroundStyle(.tint)
                if let item {
                    Text(item.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    if let detailBody { Text(detailBody).fixedSize(horizontal: false, vertical: true) }
                    if let time = alertTime {
                        Text(RelativeTimeText.fill(NSLocalizedString(time.key, comment: ""), n: time.n))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let request {
                    Text(request.sentence).font(.headline).fixedSize(horizontal: false, vertical: true)
                    LabeledContent(LocalizedStringKey("w4.requestAmount"), value: request.amountText)
                    if let expiresAt = request.expiresAt {
                        if requestExpired {
                            Text(LocalizedStringKey("w4.requestExpired"))
                        } else {
                            LabeledContent(LocalizedStringKey("w4.requestExpiry")) {
                                Text(
                                    Date(timeIntervalSince1970: Double(expiresAt) / 1_000),
                                    format: .dateTime.month(.abbreviated).day().hour().minute()
                                )
                            }
                        }
                    }
                }
                Button(action: onOpenOnPhone) {
                    Label(LocalizedStringKey("w4.openOnPhone"), systemImage: "iphone")
                }
            }
        }
        .navigationTitle(LocalizedStringKey("w4.title"))
    }
}
