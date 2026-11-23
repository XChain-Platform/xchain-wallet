// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum TokenDetailNotice: Equatable {
    case moreDetailsWhenNear
    case detailsUnavailable
}

struct TokenDetailDisplay {
    let tokenId: String
    let displayName: String
    let tick: String
    let amountText: String
    let valueText: String
    let artworkHash: String?
    let glyph: String?
    let glyphRGB: [Double]?
    let changeText: String?
    let priceSourceText: String?
    let chart: DetailChart?
    let facts: [DetailFact]
    let description: String?
    let notice: TokenDetailNotice?
}

enum TokenDetailPresenter {
    static func present(
        row: SnapshotRow,
        detail: Detail?,
        phoneReachable: Bool,
        availableArtworkHashes: Set<String> = [],
        redacted: Bool = false
    ) -> TokenDetailDisplay {
        let artworkHash = detail?.artworkHash.flatMap { hash in
            availableArtworkHashes.contains(hash) ? hash : nil
        }
        let chart = detail?.chart.flatMap { chart in
            AmountRedaction.showsPriceLine(
                redacted: redacted,
                noPrice: row.noPrice,
                pointCount: chart.points.count
            ) ? chart : nil
        }
        let glyphRGB = artworkHash == nil
            ? TokenGlyph.rgb(hex: row.tickerColor).map { [$0.r, $0.g, $0.b] }
            : nil

        return TokenDetailDisplay(
            tokenId: row.id,
            displayName: row.displayName,
            tick: row.tick,
            amountText: redacted ? "••••" : row.amountText,
            valueText: redacted ? "••••" : row.fiatText,
            artworkHash: artworkHash,
            glyph: artworkHash == nil ? TokenGlyph.letter(tick: row.tick) : nil,
            glyphRGB: glyphRGB,
            changeText: detail?.changeText,
            priceSourceText: detail?.priceSourceText,
            chart: chart,
            facts: detail?.facts ?? [],
            description: detail?.description,
            notice: notice(detail: detail, phoneReachable: phoneReachable)
        )
    }

    private static func notice(
        detail: Detail?,
        phoneReachable: Bool
    ) -> TokenDetailNotice? {
        guard detail?.hasContent != true else {
            return nil
        }
        return detail != nil || phoneReachable
            ? .detailsUnavailable
            : .moreDetailsWhenNear
    }
}

private extension Detail {
    var hasContent: Bool {
        artworkHash != nil || changeText != nil || priceSourceText != nil || chart != nil
            || facts?.isEmpty == false || description != nil
    }
}
