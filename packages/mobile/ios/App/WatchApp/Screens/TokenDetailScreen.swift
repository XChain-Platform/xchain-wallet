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

    var content: TokenDetailContent {
        TokenDetailContent(
            display: display,
            imageData: imageData,
            state: state,
            onOpenOnPhone: onOpenOnPhone
        )
    }

    var amountText: String { content.amountText }
    var showsPriceLine: Bool { content.showsPriceLine }
    var showsArtworkImage: Bool { content.showsArtworkImage }
    var noticeKey: String? { content.noticeKey }
    var factRows: [TokenDetailFactRow] { content.factRows }

    var body: some View {
        Group {
            if state.artworkExpanded {
                GeometryReader { proxy in
                    Button(action: toggleArtwork) {
                        content.artwork(side: min(proxy.size.width, proxy.size.height))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: identityLabel()))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ScrollView {
                    content
                }
            }
        }
        .navigationTitle(LocalizedStringKey("w2.title"))
    }

    func toggleAmount() { content.toggleAmount() }
    func toggleArtwork() { content.toggleArtwork() }

    var identityLabel: () -> String { content.identityLabel }
    var amountLabel: () -> String { content.amountLabel }
    var factLabel: (TokenDetailFactRow) -> String { content.factLabel }
    var controlLabel: (String) -> String { content.controlLabel }

    var amountButton: some View {
        content.amountButton
    }

    var amountTextView: some View {
        content.amountTextView
    }

    var artworkButton: some View {
        content.artworkButton
    }

    var openOnPhoneButton: some View {
        content.openOnPhoneButton
    }
}

struct TokenDetailContent: View {
    let display: TokenDetailDisplay
    let imageData: Data?
    @ObservedObject var state: TokenDetailScreenState
    let onOpenOnPhone: () -> Void

    init(
        display: TokenDetailDisplay,
        imageData: Data? = nil,
        state: TokenDetailScreenState = TokenDetailScreenState(),
        onOpenOnPhone: @escaping () -> Void
    ) {
        self.display = display
        self.imageData = imageData
        self.state = state
        self.onOpenOnPhone = onOpenOnPhone
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

    func toggleAmount() { state.showsValue.toggle() }
    func toggleArtwork() { state.artworkExpanded.toggle() }

    func identityLabel() -> String {
        AccessibilityLabels.tokenIdentity(display)
    }

    func amountLabel() -> String {
        AccessibilityLabels.tokenAmount(
            display,
            showsValue: state.showsValue,
            text: localized
        )
    }

    func factLabel(_ row: TokenDetailFactRow) -> String {
        AccessibilityLabels.labeled(
            row.label,
            value: row.value,
            localized: row.localized,
            text: localized
        )
    }

    func controlLabel(_ key: String) -> String {
        AccessibilityLabels.control(key, text: localized)
    }

    var amountButton: some View {
        Button(action: toggleAmount) {
            amountTextView
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: amountLabel()))
    }

    var amountTextView: some View {
        Text(verbatim: amountText)
            .font(.title3)
            .monospacedDigit()
            .modifier(WatchAmountFit())
    }

    var artworkButton: some View {
        Button(action: toggleArtwork) { artwork(side: 72) }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: identityLabel()))
    }

    var openOnPhoneButton: some View {
        Button(action: onOpenOnPhone) {
            Label(LocalizedStringKey("w2.openOnPhone"), systemImage: "iphone")
        }
        .accessibilityLabel(Text(verbatim: controlLabel("w2.openOnPhone")))
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
        .accessibilityLabel(Text(verbatim: factLabel(row)))
    }

    func notice(_ key: String) -> some View {
        Text(LocalizedStringKey(key))
            .accessibilityLabel(Text(verbatim: controlLabel(key)))
    }

    @ViewBuilder func artwork(side: CGFloat) -> some View {
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
