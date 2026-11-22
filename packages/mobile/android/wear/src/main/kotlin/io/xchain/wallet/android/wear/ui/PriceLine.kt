package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import io.xchain.wallet.android.wear.data.DetailChart

@Composable
fun PriceLine(chart: DetailChart, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val points = chart.points.toDoubleArray()
        val xDomain = PriceLineScale.xDomain(points.size) ?: return@Canvas
        val yDomain = PriceLineScale.yDomain(points) ?: return@Canvas
        val xRange = xDomain[1] - xDomain[0]
        val yRange = yDomain[1] - yDomain[0]
        val path = Path()

        points.forEachIndexed { index, point ->
            val x = ((index - xDomain[0]) / xRange * size.width).toFloat()
            val y = (size.height - (point - yDomain[0]) / yRange * size.height).toFloat()
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }

        val color = when (PriceLineScale.tone(chart.up)) {
            PriceLineScale.Tone.GAIN -> Color(0xFF4CAF50)
            PriceLineScale.Tone.LOSS -> Color(0xFFF44336)
        }
        drawPath(path, color, style = Stroke(width = 2.dp.toPx()))
    }
}
