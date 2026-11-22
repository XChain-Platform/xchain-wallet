// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import io.xchain.wallet.android.wear.data.SnapshotQr
import io.xchain.wallet.android.wear.ui.InscribedSquare
import io.xchain.wallet.android.wear.ui.Qr
import io.xchain.wallet.android.wear.ui.QrModules
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class QrTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun decodesSnapshotQrAndDrawsItsModulesInsideTheRoundScreen() {
        val snapshot = Json.parseToJsonElement(SNAPSHOT_FIXTURE).jsonObject
        val qrElement = snapshot.getValue("receive").jsonArray[0].jsonObject.getValue("qr")
        val qr = Json.decodeFromJsonElement<SnapshotQr>(qrElement)

        val modules = requireNotNull(QrModules.unpack(qr.size, qr.bits))
        assertEquals(441, modules.size)
        assertTrue(modules.first())
        assertFalse(modules[1])
        assertTrue(modules.last())

        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        activity.setContent {
            Qr(qr, Modifier.requiredSize(200.dp).testTag("qr"))
        }

        val bounds = compose.onNodeWithTag("qr").fetchSemanticsNode().boundsInRoot
        val view = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        val image = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(image))

        val square = requireNotNull(InscribedSquare.fit(bounds.width.toDouble(), 0.0))
        val moduleSide = square[2] / (qr.size + QUIET_ZONE_MODULES * 2)

        fun moduleColor(index: Int): Int {
            val column = index % qr.size + QUIET_ZONE_MODULES + 0.5
            val row = index / qr.size + QUIET_ZONE_MODULES + 0.5
            val x = (bounds.left + square[0] + column * moduleSide).toInt()
            val y = (bounds.top + square[1] + row * moduleSide).toInt()
            return image.getPixel(x, y)
        }

        assertEquals(Color.BLACK, moduleColor(0))
        assertEquals(Color.WHITE, moduleColor(1))
        assertEquals(Color.BLACK, moduleColor(modules.lastIndex))

        val quietZoneX = (bounds.left + square[0] + moduleSide).toInt()
        val quietZoneY = (bounds.top + square[1] + moduleSide).toInt()
        assertEquals(Color.WHITE, image.getPixel(quietZoneX, quietZoneY))
    }

    private companion object {
        const val QUIET_ZONE_MODULES = 4

        const val SNAPSHOT_FIXTURE = """{
            "receive": [{
                "qr": {
                    "size": 21,
                    "bits": "gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA="
                }
            }]
        }"""
    }
}
