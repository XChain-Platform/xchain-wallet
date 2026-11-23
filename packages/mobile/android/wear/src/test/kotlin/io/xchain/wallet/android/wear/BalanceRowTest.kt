// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.DpRect
import io.xchain.wallet.android.wear.ui.BalanceRow
import io.xchain.wallet.android.wear.ui.BalanceRowRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BalanceRowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    @Config(qualifiers = "w192dp-h192dp-round-watch-xhdpi")
    fun smallRoundRendersCoinAmountAndStacksName() = assertRow(fiatMode = false, noPrice = false, stacked = true)

    @Test
    @Config(qualifiers = "w192dp-h192dp-round-watch-xhdpi")
    fun smallRoundRendersFiatAmountAndStacksName() = assertRow(fiatMode = true, noPrice = true, stacked = true)

    @Test
    @Config(qualifiers = "w227dp-h227dp-round-watch-xhdpi")
    fun largeRoundRendersCoinAmountBesideName() = assertRow(fiatMode = false, noPrice = false, stacked = false)

    @Test
    @Config(qualifiers = "w227dp-h227dp-round-watch-xhdpi")
    fun largeRoundRendersFiatAmountBesideName() = assertRow(fiatMode = true, noPrice = true, stacked = false)

    private fun assertRow(fiatMode: Boolean, noPrice: Boolean, stacked: Boolean) {
        val name = "Bitcoin"
        val amount = "0.5 BTC"
        val fiat = if (noPrice) "No price yet" else "\$32,000.00"
        val primary = BalanceRowRules.amountPrimary(fiatMode, amount, fiat)
        val secondary = BalanceRowRules.amountSecondary(fiatMode, amount, noPrice)
        activity.setContent {
            BalanceRow(name, "BTC", "#F7931A", amount, fiat, fiatMode, noPrice)
        }

        val nameBounds = bounds(name)
        val primaryBounds = bounds(primary)
        val secondaryBounds = secondary?.let(::bounds)
        if (secondary == null) {
            compose.onNodeWithText(fiat).assertDoesNotExist()
        }
        if (stacked) {
            assertTrue(nameBounds.bottom <= primaryBounds.top)
        } else {
            assertEquals(centerY(nameBounds), cellCenterY(primaryBounds, secondaryBounds), 1f)
        }
    }

    private fun bounds(text: String): DpRect = compose.onNodeWithText(text)
        .assertIsDisplayed()
        .getUnclippedBoundsInRoot()

    private fun cellCenterY(primary: DpRect, secondary: DpRect?): Float = secondary?.let {
        (minOf(primary.top, it.top).value + maxOf(primary.bottom, it.bottom).value) / 2f
    } ?: centerY(primary)

    private fun centerY(bounds: DpRect): Float = (bounds.top.value + bounds.bottom.value) / 2f
}
