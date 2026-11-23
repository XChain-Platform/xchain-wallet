// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

private let ageAmber = Color(red: 232.0 / 255.0, green: 161.0 / 255.0, blue: 0)

struct StateBanners: View {
    let banners: [WatchBanner]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(banners, id: \.self) { banner in
                Text(LocalizedStringKey(StateBannerRules.textKey(banner)))
                    .font(.caption2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Age: View {
    let line: WatchAgeLine
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(line == .ageAmber ? ageAmber : Color.primary)
    }
}

struct Hidden: View {
    let hidden: Bool

    var body: some View {
        if hidden {
            Text("state.hidden")
                .accessibilityLabel(Text("state.amountHidden"))
        }
    }
}
