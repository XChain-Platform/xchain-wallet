// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct RequestLongLook: View {
    let request: Request
    let openOnPhone: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let content = presentation(at: context.date) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(LocalizedStringKey(content.titleKey))
                            .font(.headline)
                        Text(content.sentence)
                        Text(content.amountText)
                            .font(.title3.weight(.semibold))
                        if let expiresAt = request.expiresAt {
                            Text(
                                timerInterval: context.date...Date(
                                    timeIntervalSince1970: TimeInterval(expiresAt) / 1_000
                                ),
                                countsDown: true
                            )
                            .font(.caption)
                        }
                        RequestLongLookOpenOnPhoneAction(
                            titleKey: content.openOnPhoneKey,
                            openOnPhone: openOnPhone
                        )
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

struct RequestLongLookOpenOnPhoneAction: View {
    let titleKey: String
    let openOnPhone: () -> Void

    var body: some View {
        Button(action: send) {
            Label(LocalizedStringKey(titleKey), systemImage: "iphone")
        }
    }

    func send() {
        openOnPhone()
    }
}
