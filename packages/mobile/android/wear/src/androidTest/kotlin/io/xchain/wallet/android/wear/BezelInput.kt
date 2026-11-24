package io.xchain.wallet.android.wear

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.performRotaryScrollInput

@OptIn(ExperimentalTestApi::class)
fun SemanticsNodeInteraction.rotateBezel(pixels: Float): SemanticsNodeInteraction =
    performRotaryScrollInput {
        rotateToScrollVertically(pixels)
    }
