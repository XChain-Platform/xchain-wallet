// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import SwiftUI

struct NotSetUpScreen: View {
    let textKey: String

    var body: some View {
        Text(Self.text(for: textKey))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    static func text(for key: String) -> String {
        NSLocalizedString(key, bundle: Bundle.main, comment: "")
    }
}
