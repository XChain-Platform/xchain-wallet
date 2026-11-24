// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R

@Composable
fun TokenDetailScreen(display: TokenDetailDisplay, artwork: ByteArray?, onOpenOnPhone: () -> Unit) =
    TokenDetailScreen(
        display,
        artwork,
        stringResource(R.string.w2_open_on_phone),
        display.notice?.let { stringResource(noticeText(it)) },
        onOpenOnPhone,
    )

@Composable
internal fun TokenDetailScreen(
    display: TokenDetailDisplay,
    artwork: ByteArray?,
    openText: String,
    noticeText: String?,
    onOpenOnPhone: () -> Unit,
) {
    val bitmap = remember(artwork) {
        artwork?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
    }
    var fullScreen by remember { mutableStateOf(false) }
    var showValue by remember { mutableStateOf(false) }
    val art: @Composable (Modifier) -> Unit = { modifier ->
        if (bitmap != null) {
            Image(bitmap, display.displayName, modifier)
        } else {
            val rgb = display.glyphRgb
            val tint = if (rgb == null) Color.Unspecified else Color(rgb[0].toFloat(), rgb[1].toFloat(), rgb[2].toFloat())
            Box(modifier, Alignment.Center) { Text(display.glyph ?: TokenGlyph.letter(display.tick), color = tint) }
        }
    }
    if (fullScreen) {
        Box(Modifier.fillMaxSize().clickable { fullScreen = false }, Alignment.Center) { art(Modifier.fillMaxSize()) }
        return
    }
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            BoxWithConstraints(Modifier.fillMaxWidth(), Alignment.Center) {
                val side = InscribedSquare.side(maxWidth.value.toDouble()).dp
                art(Modifier.size(side).clickable { fullScreen = true })
            }
        }
        item { Text(display.displayName) }
        item { Text(display.tick) }
        item {
            Text(if (showValue) display.valueText else display.amountText, Modifier.clickable { showValue = !showValue })
        }
        display.changeText?.let { item { Text(it) } }
        display.chart?.let { item { PriceLine(it, Modifier.fillMaxWidth().height(48.dp).testTag("price-line")) } }
        display.priceSourceText?.let { item { Text(it) } }
        noticeText?.let { item { Text(it) } }
        items(display.facts.size) { Text("${display.facts[it].label}: ${display.facts[it].value}") }
        display.description?.let { item { Text(it) } }
        item { Button(onClick = onOpenOnPhone, label = { Text(openText) }) }
    }
}

private fun noticeText(notice: TokenDetailNotice) = when (notice) {
    TokenDetailNotice.MORE_DETAILS_WHEN_NEAR -> R.string.w2_more_details
    TokenDetailNotice.DETAILS_UNAVAILABLE -> R.string.w2_details_unavailable
}
