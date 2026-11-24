// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct RequestLongLook: View {
    let request: Request
    let openOnPhone: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            longLookContent(at: context.date)
        }
    }

    @ViewBuilder
    func longLookContent(at date: Date) -> some View {
        if let content = presentation(at: date) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(LocalizedStringKey(content.titleKey))
                        .font(.headline)
                    Text(content.sentence)
                    Text(content.amountText)
                        .font(.title3.weight(.semibold))
                    if let expiresAt = request.expiresAt {
                        Text(
                            timerInterval: date...Date(
                                timeIntervalSince1970: TimeInterval(expiresAt) / 1_000
                            ),
                            countsDown: true
                        )
                        .font(.caption)
                    }
                    Button(action: openOnPhone) {
                        Label(LocalizedStringKey(content.openOnPhoneKey), systemImage: "iphone")
                    }
                }
            }
        }
    }

    func presentation(at date: Date) -> RequestLongLookRules.Content? {
        RequestLongLookRules.content(
            kind: request.kind.rawValue,
            sentence: request.sentence,
            amountText: request.amountText,
            expiresAt: request.expiresAt,
            now: Int64(date.timeIntervalSince1970 * 1_000)
        )
    }
}
