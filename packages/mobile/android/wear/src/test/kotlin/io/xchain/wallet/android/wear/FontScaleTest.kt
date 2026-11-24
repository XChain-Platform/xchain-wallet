// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.TextLayoutResult
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProvideTextStyle
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.WithFontScale
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FontScaleTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        RuntimeEnvironment.setQualifiers(WearRenderFrames.Size.SMALL_ROUND.qualifiers())
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun largerFontScaleExpandsTextLayout() {
        val normal = renderText(1.0f)
        val large = renderText(1.3f)

        assertTrue(
            "expected width ${large.size.width} to be at least 1.25 times ${normal.size.width}",
            large.size.width >= normal.size.width * 1.25f,
        )
        assertTrue(
            "expected height ${large.size.height} to exceed ${normal.size.height}",
            large.size.height > normal.size.height,
        )
    }

    @Test
    fun zeroFontScaleThrows() {
        assertThrows(IllegalArgumentException::class.java) {
            activity.setContent {
                WithFontScale(0f) {}
            }
            compose.waitForIdle()
        }
    }

    private fun renderText(scale: Float): TextLayoutResult {
        activity.setContent {
            MaterialTheme {
                WithFontScale(scale) {
                    ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
                        Text(
                            TEXT,
                            softWrap = false,
                            modifier = Modifier.wrapContentWidth(unbounded = true),
                        )
                    }
                }
            }
        }
        compose.waitForIdle()
        val results = mutableListOf<TextLayoutResult>()
        val node = compose.onNodeWithText(TEXT, useUnmergedTree = true).fetchSemanticsNode()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.single()
    }

    private companion object {
        const val TEXT = "99,999.12345678 LONG"
    }
}
