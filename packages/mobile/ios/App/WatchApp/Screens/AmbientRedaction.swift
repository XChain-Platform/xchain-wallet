// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import SwiftUI

struct AmbientRedactionState {
    let redacted: Bool

    init(luminanceReduced: Bool, phoneHidden: Bool, hideAmounts: Bool) {
        redacted = AmountRedaction.isRedacted(
            luminanceReduced: luminanceReduced,
            phoneHidden: phoneHidden,
            hideAmounts: hideAmounts
        )
    }

    func amountText(_ text: String) -> String {
        redacted ? String(localized: "state.hidden", defaultValue: "••••") : text
    }

    func amount(_ text: String) -> some View {
        Text(verbatim: amountText(text)).privacySensitive()
    }

    func showsPriceLine(noPrice: Bool, pointCount: Int) -> Bool {
        AmountRedaction.showsPriceLine(
            redacted: redacted,
            noPrice: noPrice,
            pointCount: pointCount
        )
    }
}

struct AmbientRedaction<Content: View>: View {
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let phoneHidden: Bool
    let hideAmounts: Bool
    private let content: (AmbientRedactionState) -> Content

    init(
        phoneHidden: Bool,
        hideAmounts: Bool,
        @ViewBuilder content: @escaping (AmbientRedactionState) -> Content
    ) {
        self.phoneHidden = phoneHidden
        self.hideAmounts = hideAmounts
        self.content = content
    }

    var body: some View {
        content(AmbientRedactionState(
            luminanceReduced: isLuminanceReduced,
            phoneHidden: phoneHidden,
            hideAmounts: hideAmounts
        ))
    }
}
