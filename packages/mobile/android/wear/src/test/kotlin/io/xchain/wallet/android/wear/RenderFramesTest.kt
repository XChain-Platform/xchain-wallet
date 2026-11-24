// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotReceive
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.captureFrame
import io.xchain.wallet.android.wear.render.writeFrame
import io.xchain.wallet.android.wear.ui.NotSetUpScreen
import io.xchain.wallet.android.wear.ui.ReceiveScreen
import io.xchain.wallet.android.wear.ui.TokenDetailPresenter
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
class RenderFramesTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json

    @Test
    fun writesLandedFramesAtBothSizes() {
        val row = decode<Snapshot>("snapshot-rows50.json").rows.first()
        val display = TokenDetailPresenter.present(
            row,
            decode<Detail>("detail-native.json"),
            phoneReachable = true,
        )
        val receive = decode<List<SnapshotReceive>>("receive-chains.json")

        WearRenderFrames.Size.entries.forEach { size ->
            renderCase("w2", "detail-native.json", size) {
                TokenDetailScreen(display, null, "Open on phone", null) {}
            }
            renderCase("w6", "receive-chains.json", size) {
                ReceiveScreen(receive, "Open XChain Wallet on your phone once")
            }
            renderCase("w9", "open-wallet.json", size) {
                NotSetUpScreen("Open XChain Wallet on your phone", "Open on phone") {}
            }
            renderCase("w9", "watch-disabled.json", size) {
                NotSetUpScreen("Show wallet on watch is off on your phone", "Open on phone") {}
            }
        }
    }

    private fun renderCase(
        screen: String,
        fixture: String,
        size: WearRenderFrames.Size,
        content: @Composable () -> Unit,
    ) {
        val frame = WearRenderFrames.frameName(screen, fixture, size)
        RuntimeEnvironment.setQualifiers(size.qualifiers())
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        try {
            controller.get().setContent(content = content)
            compose.waitForIdle()
            val bitmap = captureFrame(controller.get())
            assertEquals("$frame width", size.pixelSide(), bitmap.width)
            assertEquals("$frame height", size.pixelSide(), bitmap.height)
            assertTrue("$frame captured fewer than two pixel colours", hasMultipleColors(bitmap))
            writeFrame(bitmap, frame)
        } catch (failure: Throwable) {
            val framed = AssertionError(frame)
            framed.initCause(failure)
            throw framed
        } finally {
            controller.pause().stop().destroy()
        }
    }

    private fun hasMultipleColors(bitmap: Bitmap): Boolean {
        val first = bitmap.getPixel(0, 0)
        for (y in 0 until bitmap.height) {
            for (x in 0 until bitmap.width) {
                if (bitmap.getPixel(x, y) != first) return true
            }
        }
        return false
    }

    private inline fun <reified T> decode(name: String): T =
        json.decodeFromString(resource(name).readText())

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)
}
