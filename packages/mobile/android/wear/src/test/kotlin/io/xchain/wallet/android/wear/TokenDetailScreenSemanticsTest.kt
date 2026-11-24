// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import io.xchain.wallet.android.wear.data.DetailFact
import io.xchain.wallet.android.wear.ui.AmbientRedaction
import io.xchain.wallet.android.wear.ui.TokenDetailDisplay
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenDetailScreenSemanticsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun tokenDetailsExposeSpokenLabels() {
        activity.setContent {
            TokenDetailScreen(display(), null, "Open on phone", null, "Amount hidden") {}
        }

        val scrollable = compose.onNode(hasScrollToNodeAction())
        scrollable.performScrollToNode(hasContentDescription("XChain, XC"))
        compose.onAllNodes(hasContentDescription("XChain, XC")).assertCountEquals(2)

        scrollable.performScrollToNode(hasContentDescription("XChain, 42 XC"))
        compose.onNode(hasContentDescription("XChain, 42 XC")).assertIsDisplayed().performClick()

        scrollable.performScrollToNode(hasContentDescription("XChain, \$1,234.56"))
        compose.onNode(hasContentDescription("XChain, \$1,234.56")).assertIsDisplayed()

        scrollable.performScrollToNode(hasContentDescription("Supply, 21,000,000"))
        compose.onNode(hasContentDescription("Supply, 21,000,000")).assertIsDisplayed()
    }

    @Test
    fun redactedAmountExposesTheHiddenState() {
        activity.setContent {
            TokenDetailScreen(
                display(
                    amountText = AmbientRedaction.DOTS,
                    valueText = AmbientRedaction.DOTS,
                ),
                null,
                "Open on phone",
                null,
                "Amount hidden",
            ) {}
        }

        val label = "XChain, Amount hidden"
        val scrollable = compose.onNode(hasScrollToNodeAction())
        scrollable.performScrollToNode(hasContentDescription(label))
        compose.onNode(hasContentDescription(label)).assertIsDisplayed()
    }

    private fun display(
        amountText: String = "42 XC",
        valueText: String = "\$1,234.56",
    ) = TokenDetailDisplay(
        tokenId = "bitcoin-mainnet:XC",
        displayName = "XChain",
        tick = "XC",
        amountText = amountText,
        valueText = valueText,
        artworkHash = null,
        glyph = "X",
        glyphRgb = listOf(26 / 255.0, 116 / 255.0, 168 / 255.0),
        changeText = null,
        priceSourceText = null,
        chart = null,
        facts = listOf(DetailFact("Supply", "21,000,000")),
        description = null,
        notice = null,
    )
}
