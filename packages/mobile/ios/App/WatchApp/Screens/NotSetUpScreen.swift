// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import SwiftUI

struct NotSetUpScreen: View {
    let textKey: String

    var message: String { Self.text(for: textKey) }

    var body: some View {
        Text(message)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            .accessibilityLabel(message)
    }

    static func text(for key: String) -> String {
        NSLocalizedString(key, bundle: Bundle.main, comment: "")
    }
}
