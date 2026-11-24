// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct TokenDetailFactsEntry: Equatable {
    let label: String
    let labelIsKey: Bool
    let value: String
}

struct TokenDetailFactsView: View {
    let display: TokenDetailDisplay

    var entries: [TokenDetailFactsEntry] {
        var result: [TokenDetailFactsEntry] = []

        append(display.changeText, label: "w2.change24h", labelIsKey: true, to: &result)
        append(display.priceSourceText, label: "w2.priceSource", labelIsKey: true, to: &result)
        for fact in display.facts {
            append(fact.value, label: fact.label, labelIsKey: false, to: &result)
        }
        append(display.description, label: "w2.description", labelIsKey: true, to: &result)

        return result
    }

    var noticeKey: String? {
        switch display.notice {
        case .moreDetailsWhenNear:
            "w2.moreDetails"
        case .detailsUnavailable:
            "w2.detailsUnavailable"
        case nil:
            nil
        }
    }

    var body: some View {
        VStack(alignment: .leading) {
            ForEach(entries.indices, id: \.self) { index in
                let entry = entries[index]
                LabeledContent {
                    Text(entry.value)
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: false, vertical: true)
                } label: {
                    if entry.labelIsKey {
                        Text(LocalizedStringKey(entry.label))
                    } else {
                        Text(verbatim: entry.label)
                    }
                }
            }
            if let noticeKey {
                Text(LocalizedStringKey(noticeKey))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func append(
        _ value: String?,
        label: String,
        labelIsKey: Bool,
        to entries: inout [TokenDetailFactsEntry]
    ) {
        guard let value, !value.isEmpty else {
            return
        }
        entries.append(TokenDetailFactsEntry(
            label: label,
            labelIsKey: labelIsKey,
            value: value
        ))
    }
}
