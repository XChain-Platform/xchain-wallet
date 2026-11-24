// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct AlertSelection: Hashable {
    let id: String
}

struct AlertsScreen: View {
    let inbox: [SnapshotInboxItem]
    let now: Int64
    let markRead: (MarkReadIntent) -> Void

    var rows: [SnapshotInboxItem] {
        AlertsRules.newestFirst(inbox, at: \SnapshotInboxItem.at)
    }

    var body: some View {
        List {
            if rows.isEmpty {
                Text("w3.empty")
                    .accessibilityLabel(Text(verbatim: AccessibilityLabels.control(
                        "w3.empty",
                        text: { NSLocalizedString($0, comment: "") }
                    )))
            } else {
                ForEach(rows, id: \.id) { item in
                    rowLink(item)
                }
            }
        }
        .navigationTitle("w3.title")
    }

    func rowLink(_ item: SnapshotInboxItem) -> some View {
        NavigationLink(value: AlertSelection(id: item.id)) {
            row(item)
        }
        .simultaneousGesture(TapGesture().onEnded {
            markRead(MarkReadIntent(id: item.id))
        })
        .accessibilityLabel(Text(verbatim: AccessibilityLabels.alertRow(
            item,
            time: relativeTime(item)
        )))
    }

    private func relativeTime(_ item: SnapshotInboxItem) -> String {
        let value = RelativeTimeText.alertKey(at: item.at, now: now)
        let template = NSLocalizedString(value.key, comment: "")
        return RelativeTimeText.fill(template, n: value.n)
    }

    private func row(_ item: SnapshotInboxItem) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: AlertFamilyIcon.symbol(family: item.family))
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(verbatim: item.title).lineLimit(1)
                    Spacer()
                    if !item.read {
                        Circle().fill(.tint).frame(width: 6, height: 6)
                    }
                }
                Text(verbatim: item.body).font(.caption).lineLimit(1)
                Text(verbatim: relativeTime(item)).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
