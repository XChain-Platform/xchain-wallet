// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

@Composable
fun BalanceRow(
    name: String,
    tick: String,
    tickerColor: String,
    amountText: String,
    fiatText: String,
    fiatMode: Boolean,
    noPrice: Boolean,
    modifier: Modifier = Modifier,
    chainPipColor: Color = MaterialTheme.colorScheme.primary,
) {
    val primary = BalanceRowRules.amountPrimary(fiatMode, amountText, fiatText)
    val secondary = BalanceRowRules.amountSecondary(fiatMode, amountText, noPrice)
    val stacked = BalanceRowRules.stacksNameOverAmount(LocalConfiguration.current.screenWidthDp)

    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TokenIcon(tick, tickerColor, chainPipColor)
        Spacer(Modifier.width(8.dp))
        if (stacked) {
            Column(Modifier.weight(1f)) {
                Name(name)
                AmountCell(primary, secondary, Modifier.fillMaxWidth())
            }
        } else {
            Name(name, Modifier.weight(1f))
            AmountCell(primary, secondary)
        }
    }
}

@Composable
private fun Name(name: String, modifier: Modifier = Modifier) = Text(
    text = name,
    modifier = modifier,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
)

@Composable
private fun AmountCell(primary: String, secondary: String?, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.End) {
        Text(primary)
        secondary?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
    }
}

@Composable
private fun TokenIcon(tick: String, tickerColor: String, pipColor: Color) {
    val rgb = TokenGlyph.rgb(tickerColor)
    val color = rgb?.let { Color(it[0].toFloat(), it[1].toFloat(), it[2].toFloat()) }
        ?: MaterialTheme.colorScheme.surfaceVariant
    Box(Modifier.size(28.dp).background(color, CircleShape), contentAlignment = Alignment.Center) {
        Text(TokenGlyph.letter(tick), color = MaterialTheme.colorScheme.onSurface)
        Box(
            Modifier.align(Alignment.BottomEnd).size(8.dp)
                .background(pipColor, CircleShape)
                .border(1.dp, MaterialTheme.colorScheme.background, CircleShape),
        )
    }
}
