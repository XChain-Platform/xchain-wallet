package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.SnapshotRow
import io.xchain.wallet.android.wear.ui.AmbientRedaction
import io.xchain.wallet.android.wear.ui.TokenDetailNotice
import io.xchain.wallet.android.wear.ui.TokenDetailPresenter
import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenDetailPresenterTest {
    private val json = Json

    @Test
    fun decodesAndPresentsEveryDetailFixture() {
        fixtures().forEach { file ->
            val detail = json.decodeFromString<Detail>(file.readText())
            val display = TokenDetailPresenter.present(row(detail.tokenId), detail, phoneReachable = true)

            assertEquals(detail.tokenId, display.tokenId)
            assertEquals(detail.facts.orEmpty(), display.facts)
        }
    }

    @Test
    fun cachedArtworkUsesGlyphUntilTheFileLands() {
        val detail = fixture("detail-cached.json")

        val waiting = TokenDetailPresenter.present(row(detail.tokenId), detail, phoneReachable = true)
        assertNull(waiting.artworkHash)
        assertEquals("X", waiting.glyph)
        assertEquals(listOf(26 / 255.0, 116 / 255.0, 168 / 255.0), waiting.glyphRgb)

        val landed = TokenDetailPresenter.present(
            row(detail.tokenId),
            detail,
            phoneReachable = true,
            availableArtworkHashes = setOf("xc-artwork-cache"),
        )
        assertEquals("xc-artwork-cache", landed.artworkHash)
        assertNull(landed.glyph)
        assertNull(landed.glyphRgb)
        assertEquals(5, landed.facts.size)
        assertNull(landed.notice)
    }

    @Test
    fun absentArtworkAlwaysUsesTheTickerGlyph() {
        val detail = fixture("detail-noart.json")
        val display = TokenDetailPresenter.present(row(detail.tokenId), detail, phoneReachable = true)

        assertNull(display.artworkHash)
        assertEquals("X", display.glyph)
    }

    @Test
    fun nativeChartIsKeptWithItsDirection() {
        val detail = fixture("detail-native.json")
        val display = TokenDetailPresenter.present(row(detail.tokenId, tick = "BTC"), detail, true)

        assertEquals(48, display.chart?.points?.size)
        assertFalse(requireNotNull(display.chart).up)
        assertNull(display.notice)
    }

    @Test
    fun hiddenAndUnpricedDetailsDropTheChart() {
        val detail = fixture("detail-native.json")
        val hidden = TokenDetailPresenter.present(
            row(detail.tokenId, tick = "BTC"),
            detail,
            phoneReachable = true,
            redacted = true,
        )
        val unpriced = TokenDetailPresenter.present(
            row(detail.tokenId, tick = "BTC", noPrice = true),
            detail,
            phoneReachable = true,
        )

        assertEquals(AmbientRedaction.DOTS, hidden.amountText)
        assertEquals(AmbientRedaction.DOTS, hidden.valueText)
        assertNull(hidden.chart)
        assertNull(unpriced.chart)
    }

    @Test
    fun missingAndFailedDetailsHaveDistinctNotices() {
        val displayRow = row("bitcoin-mainnet:XC")
        val away = TokenDetailPresenter.present(displayRow, null, phoneReachable = false)
        val failed = TokenDetailPresenter.present(
            displayRow,
            fixture("detail-loaderror.json"),
            phoneReachable = true,
        )

        assertEquals(TokenDetailNotice.MORE_DETAILS_WHEN_NEAR, away.notice)
        assertEquals(TokenDetailNotice.DETAILS_UNAVAILABLE, failed.notice)
        assertTrue(failed.facts.isEmpty())
    }

    private fun fixture(name: String): Detail =
        checkNotNull(javaClass.classLoader?.getResource(name))
            .readText()
            .let { json.decodeFromString(it) }

    private fun fixtures(): List<File> {
        val first = checkNotNull(javaClass.classLoader?.getResource("detail-cached.json"))
            .toURI()
            .let(::File)
        return requireNotNull(first.parentFile.listFiles())
            .filter { it.isFile && it.name.startsWith("detail-") && it.extension == "json" }
            .sortedBy { it.name }
            .also { assertTrue("No detail fixtures found", it.isNotEmpty()) }
    }

    private fun row(
        id: String,
        tick: String = "XC",
        noPrice: Boolean = false,
    ) = SnapshotRow(
        id = id,
        chainId = "bitcoin-mainnet",
        tick = tick,
        displayName = if (tick == "BTC") "Bitcoin" else "XChain",
        amountText = if (tick == "BTC") "0.50 BTC" else "42 XC",
        fiatText = if (noPrice) "No price yet" else "$1,234.56",
        noPrice = noPrice,
        pendingText = "",
        unavailable = false,
        iconHash = "icon-cache",
        tickerColor = "#1A74A8",
        hasDetail = true,
    )
}
