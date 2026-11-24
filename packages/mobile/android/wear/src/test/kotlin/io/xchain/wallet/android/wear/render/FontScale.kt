// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.render

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density

@Composable
fun WithFontScale(scale: Float, content: @Composable () -> Unit) {
    require(scale > 0f)
    val density = LocalDensity.current.density
    CompositionLocalProvider(
        LocalDensity provides Density(density, scale),
        content = content,
    )
}
