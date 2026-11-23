// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import io.xchain.wallet.android.wear.data.DetailChart
import io.xchain.wallet.android.wear.data.DetailFact
import io.xchain.wallet.android.wear.ui.TokenDetailDisplay
import io.xchain.wallet.android.wear.ui.TokenDetailNotice
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenDetailScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun showsGlyphFactsAndTogglesTheAmountOnTap() {
        activity.setContent { TokenDetailScreen(display(), null, "Open on phone", null) {} }

        compose.onNodeWithText("XChain").assertIsDisplayed()
        compose.onNodeWithText("X").assertIsDisplayed()
        compose.onNodeWithText("42 XC").performClick()
        compose.onNodeWithText("$1,234.56").assertIsDisplayed()
        compose.onNodeWithText("Supply: 21,000,000").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun artworkTapOpensFullScreenAndBack() {
        activity.setContent { TokenDetailScreen(display(), null, "Open on phone", null) {} }

        compose.onNodeWithText("X").performClick()
        compose.onNodeWithText("XChain").assertDoesNotExist()
        compose.onNodeWithText("X").performClick()
        compose.onNodeWithText("XChain").assertIsDisplayed()
    }

    @Test
    fun showsPriceLineWhenChartHasPoints() {
        activity.setContent {
            TokenDetailScreen(display(chart = DetailChart(listOf(1.0, 2.0, 1.5), up = true)), null, "Open on phone", null) {}
        }

        compose.onNodeWithTag("price-line").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun openOnPhoneInvokesTheAction() {
        var opened = 0
        activity.setContent {
            TokenDetailScreen(display(), null, "Open on phone", null) { opened++ }
        }

        repeat(3) { compose.onRoot().performTouchInput { swipeUp() } }
        compose.onNodeWithText("Open on phone").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun showsTheNoticeWhenDetailsAreMissing() {
        activity.setContent {
            TokenDetailScreen(display(notice = TokenDetailNotice.MORE_DETAILS_WHEN_NEAR, facts = emptyList()), null, "Open on phone", "More details when your phone is near") {}
        }

        compose.onNodeWithText("More details when your phone is near").performScrollTo().assertIsDisplayed()
    }

    private fun display(
        chart: DetailChart? = null,
        notice: TokenDetailNotice? = null,
        facts: List<DetailFact> = listOf(DetailFact("Supply", "21,000,000")),
    ) = TokenDetailDisplay(
        tokenId = "bitcoin-mainnet:XC",
        displayName = "XChain",
        tick = "XC",
        amountText = "42 XC",
        valueText = "$1,234.56",
        artworkHash = null,
        glyph = "X",
        glyphRgb = listOf(26 / 255.0, 116 / 255.0, 168 / 255.0),
        changeText = null,
        priceSourceText = null,
        chart = chart,
        facts = facts,
        description = null,
        notice = notice,
    )
}
