// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import UIKit

struct TokenDetailFactRow: Equatable {
    let label: String
    let localized: Bool
    let value: String
}

final class TokenDetailScreenState: ObservableObject {
    @Published var showsValue = false
    @Published var artworkExpanded = false
}

struct TokenDetailScreen: View {
    let display: TokenDetailDisplay
    let imageData: Data?
    let onOpenOnPhone: () -> Void
    @StateObject private var state: TokenDetailScreenState

    init(
        display: TokenDetailDisplay,
        imageData: Data? = nil,
        state: TokenDetailScreenState = TokenDetailScreenState(),
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.display = display
        self.imageData = imageData
        self.onOpenOnPhone = onOpenOnPhone
        _state = StateObject(wrappedValue: state)
    }

    var amountText: String { state.showsValue ? display.valueText : display.amountText }
    var showsPriceLine: Bool { display.chart?.points.isEmpty == false }
    var showsArtworkImage: Bool { display.artworkHash != nil && artworkImage != nil }
    var noticeKey: String? {
        switch display.notice {
        case .moreDetailsWhenNear: return "w2.moreDetails"
        case .detailsUnavailable: return "w2.detailsUnavailable"
        case nil: return nil
        }
    }
    var factRows: [TokenDetailFactRow] {
        var rows = [
            TokenDetailFactRow(label: "w2.change24h", localized: true,
                               value: display.changeText ?? ""),
            TokenDetailFactRow(label: "w2.priceSource", localized: true,
                               value: display.priceSourceText ?? ""),
        ]
        rows += display.facts.map {
            TokenDetailFactRow(label: $0.label, localized: false, value: $0.value)
        }
        rows.append(TokenDetailFactRow(label: "w2.description", localized: true,
                                       value: display.description ?? ""))
        return rows.filter { !$0.value.isEmpty }
    }

    var body: some View {
        Group {
            if state.artworkExpanded {
                GeometryReader { proxy in
                    Button(action: toggleArtwork) {
                        artwork(side: min(proxy.size.width, proxy.size.height))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: AccessibilityLabels.tokenIdentity(display)))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        artworkButton
                        Text(verbatim: display.displayName).font(.headline).accessibilityHidden(true)
                        Text(verbatim: display.tick).foregroundStyle(.secondary).accessibilityHidden(true)
                        amountButton
                        if let chart = display.chart, !chart.points.isEmpty {
                            PriceLineView(chart: chart).frame(height: 54).accessibilityHidden(true)
                        }
                        facts
                        openOnPhoneButton
                    }
                }
            }
        }
        .navigationTitle(LocalizedStringKey("w2.title"))
    }

    func toggleAmount() { state.showsValue.toggle() }
    func toggleArtwork() { state.artworkExpanded.toggle() }

    var amountButton: some View {
        Button(action: toggleAmount) {
            Text(verbatim: amountText)
                .font(.title3)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: AccessibilityLabels.tokenAmount(
            display,
            showsValue: state.showsValue,
            text: localized
        )))
    }

    var artworkButton: some View {
        Button(action: toggleArtwork) { artwork(side: 72) }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: AccessibilityLabels.tokenIdentity(display)))
    }

    var openOnPhoneButton: some View {
        Button(action: onOpenOnPhone) {
            Label(LocalizedStringKey("w2.openOnPhone"), systemImage: "iphone")
        }
        .accessibilityLabel(Text(verbatim: AccessibilityLabels.control(
            "w2.openOnPhone", text: localized
        )))
    }

    @ViewBuilder private var facts: some View {
        ForEach(Array(factRows.enumerated()), id: \.offset) { _, row in
            factRow(row)
        }
        if let noticeKey {
            notice(noticeKey)
        }
    }

    func factRow(_ row: TokenDetailFactRow) -> some View {
        LabeledContent {
            Text(verbatim: row.value).fixedSize(horizontal: false, vertical: true)
        } label: {
            if row.localized { Text(LocalizedStringKey(row.label)) }
            else { Text(verbatim: row.label) }
        }
        .accessibilityLabel(Text(verbatim: AccessibilityLabels.labeled(
            row.label,
            value: row.value,
            localized: row.localized,
            text: localized
        )))
    }

    func notice(_ key: String) -> some View {
        Text(LocalizedStringKey(key))
            .accessibilityLabel(Text(verbatim: AccessibilityLabels.control(
                key, text: localized
            )))
    }

    @ViewBuilder private func artwork(side: CGFloat) -> some View {
        if showsArtworkImage, let artworkImage {
            Image(uiImage: artworkImage).resizable().scaledToFit()
                .frame(width: side, height: side)
        } else {
            Circle().fill(glyphColor).frame(width: side, height: side).overlay {
                Text(verbatim: display.glyph ?? String(display.tick.prefix(1)).uppercased())
                    .font(.title).foregroundStyle(.white)
            }
        }
    }

    private var artworkImage: UIImage? { imageData.flatMap(UIImage.init(data:)) }
    private func localized(_ key: String) -> String { NSLocalizedString(key, comment: "") }
    private var glyphColor: Color {
        guard let rgb = display.glyphRGB, rgb.count == 3 else { return .gray }
        return Color(red: rgb[0], green: rgb[1], blue: rgb[2])
    }
}
