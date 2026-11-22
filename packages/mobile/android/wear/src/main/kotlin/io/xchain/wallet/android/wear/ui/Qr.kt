// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import io.xchain.wallet.android.wear.data.SnapshotQr
import kotlin.math.min

private const val QUIET_ZONE_MODULES = 4

@Composable
fun Qr(qr: SnapshotQr, modifier: Modifier = Modifier) {
    val modules = remember(qr) { QrModules.unpack(qr.size, qr.bits) } ?: return
    Canvas(modifier) {
        val diameter = min(size.width, size.height).toDouble()
        val square = InscribedSquare.fit(diameter, 0.0) ?: return@Canvas
        val origin = Offset(
            (size.width - diameter.toFloat()) / 2f + square[0].toFloat(),
            (size.height - diameter.toFloat()) / 2f + square[1].toFloat(),
        )
        val side = square[2].toFloat()
        drawRect(Color.White, origin, Size(side, side))
        val moduleSide = side / (qr.size + QUIET_ZONE_MODULES * 2)
        modules.forEachIndexed { index, filled ->
            if (filled) {
                val column = index % qr.size + QUIET_ZONE_MODULES
                val row = index / qr.size + QUIET_ZONE_MODULES
                drawRect(
                    Color.Black,
                    origin + Offset(column * moduleSide, row * moduleSide),
                    Size(moduleSide, moduleSide),
                )
            }
        }
    }
}
