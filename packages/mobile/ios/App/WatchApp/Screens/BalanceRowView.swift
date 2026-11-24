// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import WatchKit

enum BalanceRowLayout: Equatable {
    case stacked
    case inline
}

struct BalanceRowView: View {
    static let amountMinimumScale: CGFloat = 0.5

    let name: String
    let chainId: String
    let tick: String
    let tickerColor: String
    let amountCell: (primary: String, secondary: String?)
    let screenWidth: Double

    init(
        name: String,
        chainId: String,
        tick: String,
        tickerColor: String,
        amountCell: (primary: String, secondary: String?),
        screenWidth: Double = Double(WKInterfaceDevice.current().screenBounds.width)
    ) {
        self.name = name
        self.chainId = chainId
        self.tick = tick
        self.tickerColor = tickerColor
        self.amountCell = amountCell
        self.screenWidth = screenWidth
    }

    var layout: BalanceRowLayout {
        BalanceRowRules.stacksNameOverAmount(screenWidth: screenWidth) ? .stacked : .inline
    }

    var icon: BalanceRowIcon {
        BalanceRowIcon(chainId: chainId, tick: tick, tickerColor: tickerColor)
    }

    var body: BalanceRowContent {
        BalanceRowContent(name: name, amountCell: amountCell, layout: layout, icon: icon)
    }
}

struct BalanceRowContent: View {
    let name: String
    let amountCell: (primary: String, secondary: String?)
    let layout: BalanceRowLayout
    let icon: BalanceRowIcon

    var body: some View {
        HStack(spacing: 8) {
            icon
            switch layout {
            case .stacked:
                VStack(alignment: .leading, spacing: 2) {
                    nameText
                    amount.frame(maxWidth: .infinity, alignment: .trailing)
                }
            case .inline:
                nameText
                Spacer(minLength: 4)
                amount
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var nameText: some View {
        Text(name).lineLimit(1).truncationMode(.tail)
    }

    private var amount: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(amountCell.primary)
                .lineLimit(1)
                .minimumScaleFactor(BalanceRowView.amountMinimumScale)
            if let secondary = amountCell.secondary {
                Text(secondary)
                    .font(.caption2)
                    .lineLimit(1)
                    .minimumScaleFactor(BalanceRowView.amountMinimumScale)
            }
        }
    }
}

struct BalanceRowIcon: View {
    let chainId: String
    let tick: String
    let tickerColor: String

    var size: Double { BalanceRowRules.iconPoints }

    var chainPipHueDegrees: Int {
        chainId.utf8.reduce(0) { ($0 * 31 + Int($1)) % 360 }
    }

    var body: some View {
        let rgb = TokenGlyph.rgb(hex: tickerColor)
        let color = rgb.map { Color(red: $0.r, green: $0.g, blue: $0.b) } ?? .gray
        return ZStack(alignment: .bottomTrailing) {
            Circle().fill(color)
            Text(TokenGlyph.letter(tick: tick)).foregroundStyle(.white)
            Circle()
                .fill(Color(
                    hue: Double(chainPipHueDegrees) / 360,
                    saturation: 0.8,
                    brightness: 0.95
                ))
                .stroke(.black, lineWidth: 1)
                .frame(width: 8, height: 8)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
