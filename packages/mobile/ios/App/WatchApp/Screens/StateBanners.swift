// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

private let ageAmber = Color(red: 232.0 / 255.0, green: 161.0 / 255.0, blue: 0)

private struct BannerText: View {
    let key: String

    var body: some View {
        Text(LocalizedStringKey(key))
            .font(.caption2)
    }
}

struct Loading: View {
    static let textKey = "state.loading"

    var body: some View {
        BannerText(key: Self.textKey)
    }
}

struct Locked: View {
    static let textKey = "state.locked"

    var body: some View {
        BannerText(key: Self.textKey)
    }
}

struct Unreachable: View {
    static let textKey = "state.unreachable"

    var body: some View {
        BannerText(key: Self.textKey)
    }
}

struct StateBanners: View {
    let banners: [WatchBanner]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(banners, id: \.self) { banner in
                switch banner {
                case .loading:
                    Loading()
                case .locked:
                    Locked()
                case .unreachable:
                    Unreachable()
                case .stale24h:
                    BannerText(key: StateBannerRules.textKey(banner))
                }
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
    static let accessibilityKey = "state.amountHidden"
    static let textKey = "state.hidden"

    let hidden: Bool

    var body: some View {
        if hidden {
            Text(LocalizedStringKey(Self.textKey))
                .accessibilityLabel(Text(LocalizedStringKey(Self.accessibilityKey)))
        }
    }
}
