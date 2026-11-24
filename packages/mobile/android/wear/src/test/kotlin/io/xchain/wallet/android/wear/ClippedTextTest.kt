// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.ui.BalanceRow
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
class ClippedTextTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    @Config(qualifiers = "w192dp-h192dp-round-watch-xhdpi")
    fun balanceRowHasNoClippedTextOnSmallRound() {
        setBalanceRow()

        assertEquals(emptyList<String>(), clippedTexts(compose))
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round-watch-xhdpi")
    fun balanceRowHasNoClippedTextOnLargeRound() {
        setBalanceRow()

        assertEquals(emptyList<String>(), clippedTexts(compose))
    }

    @Test
    fun ellipsizedTextIsClipped() {
        val text = List(30) { "0.5 BTC" }.joinToString("\n")
        activity.setContent {
            Box(Modifier.width(40.dp)) {
                Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }

        assertEquals(listOf(text), clippedTexts(compose))
    }

    @Test
    fun hardClippedTextIsClipped() {
        val text = List(30) { "0.5 BTC" }.joinToString("\n")
        activity.setContent {
            Box(Modifier.width(40.dp)) {
                Text(text, maxLines = 1, softWrap = false, overflow = TextOverflow.Clip)
            }
        }

        assertEquals(listOf(text), clippedTexts(compose))
    }

    @Test
    fun fittingTextIsNotClipped() {
        activity.setContent {
            Box(Modifier.width(40.dp)) {
                Text("OK")
            }
        }

        assertEquals(emptyList<String>(), clippedTexts(compose))
    }

    private fun setBalanceRow() {
        activity.setContent {
            BalanceRow("Bitcoin", "BTC", "#F7931A", "0.5 BTC", "\$32,000.00", false, false)
        }
    }
}
