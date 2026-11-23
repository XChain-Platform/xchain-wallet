// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.DetailChart
import io.xchain.wallet.android.wear.data.DetailFact
import io.xchain.wallet.android.wear.data.SnapshotRow
import io.xchain.wallet.android.wear.data.WatchDisplayRules

enum class TokenDetailNotice {
    MORE_DETAILS_WHEN_NEAR,
    DETAILS_UNAVAILABLE,
}

data class TokenDetailDisplay(
    val tokenId: String,
    val displayName: String,
    val tick: String,
    val amountText: String,
    val valueText: String,
    val artworkHash: String?,
    val glyph: String?,
    val glyphRgb: List<Double>?,
    val changeText: String?,
    val priceSourceText: String?,
    val chart: DetailChart?,
    val facts: List<DetailFact>,
    val description: String?,
    val notice: TokenDetailNotice?,
)

object TokenDetailPresenter {
    fun present(
        row: SnapshotRow,
        detail: Detail?,
        phoneReachable: Boolean,
        availableArtworkHashes: Set<String> = emptySet(),
        redacted: Boolean = false,
    ): TokenDetailDisplay {
        val loaded = detail?.hasContent() == true
        val artworkHash = detail?.artworkHash?.takeIf(availableArtworkHashes::contains)
        val chart = detail?.chart?.takeIf {
            WatchDisplayRules.showsPriceLine(redacted, row.noPrice, it.points.size)
        }
        val glyphRgb = if (artworkHash == null) TokenGlyph.rgb(row.tickerColor)?.toList() else null
        return TokenDetailDisplay(
            tokenId = row.id,
            displayName = row.displayName,
            tick = row.tick,
            amountText = if (redacted) AmbientRedaction.DOTS else row.amountText,
            valueText = if (redacted) AmbientRedaction.DOTS else row.fiatText,
            artworkHash = artworkHash,
            glyph = if (artworkHash == null) TokenGlyph.letter(row.tick) else null,
            glyphRgb = glyphRgb,
            changeText = detail?.changeText,
            priceSourceText = detail?.priceSourceText,
            chart = chart,
            facts = detail?.facts.orEmpty(),
            description = detail?.description,
            notice = when {
                loaded -> null
                detail != null || phoneReachable -> TokenDetailNotice.DETAILS_UNAVAILABLE
                else -> TokenDetailNotice.MORE_DETAILS_WHEN_NEAR
            },
        )
    }

    private fun Detail.hasContent(): Boolean =
        artworkHash != null || changeText != null || priceSourceText != null || chart != null ||
            !facts.isNullOrEmpty() || description != null
}
