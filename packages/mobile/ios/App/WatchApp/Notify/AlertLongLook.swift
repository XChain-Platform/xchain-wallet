// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct AlertLongLook: View {
    let item: SnapshotInboxItem
    let now: Int64
    let alwaysOn: Bool?

    @Environment(\.isLuminanceReduced) private var luminanceReduced

    init(
        item: SnapshotInboxItem,
        now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
        alwaysOn: Bool? = nil
    ) {
        self.item = item
        self.now = now
        self.alwaysOn = alwaysOn
    }

    var kindKey: String {
        AlertKindLabel.key(kind: item.kind) ?? "w3.title"
    }

    var familySymbol: String {
        AlertFamilyIcon.symbol(family: item.family)
    }

    var relativeTime: (key: String, n: Int) {
        RelativeTimeText.alertKey(at: item.at, now: now)
    }

    var showsDetails: Bool {
        !(alwaysOn ?? luminanceReduced)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsDetails {
                Label(LocalizedStringKey(kindKey), systemImage: familySymbol)
                    .font(.caption2.bold())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.2), in: Capsule())
                Text(item.title).font(.headline)
                if !item.body.isEmpty {
                    Text(item.body).font(.body)
                }
                Text(relativeTimeText).font(.footnote).foregroundStyle(.secondary)
            } else {
                Text(LocalizedStringKey(kindKey)).font(.headline)
            }
        }
    }

    private var relativeTimeText: String {
        let value = relativeTime
        let template = NSLocalizedString(value.key, comment: "")
        return RelativeTimeText.fill(template, n: value.n)
    }
}
