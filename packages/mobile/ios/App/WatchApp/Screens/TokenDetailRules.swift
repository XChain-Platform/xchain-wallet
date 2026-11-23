import Foundation

enum TokenDetailState: String {
    case full
    case unavailable
    case awayNotCached
    case waiting
}

enum TokenDetailArtwork: Equatable {
    case image(hash: String)
    case glyph
}

enum TokenDetailRules {
    static func state(
        rowId: String,
        detail: Detail?,
        phoneReachable: Bool
    ) -> TokenDetailState {
        guard let detail, detail.tokenId == rowId else {
            return phoneReachable ? .waiting : .awayNotCached
        }

        let hasText = [
            detail.changeText,
            detail.priceSourceText,
            detail.description,
            detail.artworkHash,
        ].contains { value in
            value?.isEmpty == false
        }
        let hasFact = detail.facts?.isEmpty == false
        let hasChartPoint = detail.chart?.points.isEmpty == false

        return hasText || hasFact || hasChartPoint ? .full : .unavailable
    }

    static func noticeKey(_ state: TokenDetailState) -> String? {
        switch state {
        case .awayNotCached:
            return "w2.moreDetails"
        case .unavailable:
            return "w2.detailsUnavailable"
        case .full, .waiting:
            return nil
        }
    }

    static func artwork(
        artworkHash: String?,
        imageCached: Bool
    ) -> TokenDetailArtwork {
        guard let artworkHash, !artworkHash.isEmpty, imageCached else {
            return .glyph
        }
        return .image(hash: artworkHash)
    }
}
