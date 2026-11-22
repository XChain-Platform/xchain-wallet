package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.ui.AmbientRedaction
import io.xchain.wallet.android.wear.ui.ambientRedaction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AmbientRedactionTest {
    @Test
    fun visibleAmountsAndPriceLineStayVisible() {
        val state = ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = false)

        assertEquals("$1,234.56", state.amount("$1,234.56"))
        assertTrue(state.showsPriceLine(noPrice = false, pointCount = 2))
    }

    @Test
    fun ambientModeRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = true, phoneHidden = false, hideAmounts = false))
    }

    @Test
    fun phoneEyeRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = false, phoneHidden = true, hideAmounts = false))
    }

    @Test
    fun hideAmountsRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = true))
    }

    @Test
    fun visiblePriceLineStillNeedsPriceAndTwoPoints() {
        val state = ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = false)

        assertFalse(state.showsPriceLine(noPrice = true, pointCount = 48))
        assertFalse(state.showsPriceLine(noPrice = false, pointCount = 1))
    }

    private fun assertRedacted(state: AmbientRedaction) {
        assertEquals(AmbientRedaction.DOTS, state.amount("0.5 BTC"))
        assertFalse(state.showsPriceLine(noPrice = false, pointCount = 48))
    }
}
