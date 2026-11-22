package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.lifecycle.LifecycleOwner
import androidx.wear.ambient.AmbientLifecycleObserver
import io.xchain.wallet.android.wear.ui.AmbientRedaction
import io.xchain.wallet.android.wear.ui.LocalAmbientObserverFactory
import io.xchain.wallet.android.wear.ui.ambientRedaction
import io.xchain.wallet.android.wear.ui.rememberAmbientRedaction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AmbientRedactionTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun visibleAmountsAndPriceLineStayVisible() {
        val state = ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = false)

        assertEquals("$1,234.56", state.amount("$1,234.56"))
        assertTrue(state.showsPriceLine(noPrice = false, pointCount = 2))
    }

    @Test
    fun ambientModeRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = true, phoneHidden = false, hideAmounts = false))
    }

    @Test
    fun phoneEyeRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = false, phoneHidden = true, hideAmounts = false))
    }

    @Test
    fun hideAmountsRedactsAmountsAndPriceLine() {
        assertRedacted(ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = true))
    }

    @Test
    fun visiblePriceLineStillNeedsPriceAndTwoPoints() {
        val state = ambientRedaction(ambient = false, phoneHidden = false, hideAmounts = false)

        assertFalse(state.showsPriceLine(noPrice = true, pointCount = 48))
        assertFalse(state.showsPriceLine(noPrice = false, pointCount = 1))
    }

    @Test
    fun ambientLifecycleObserverDrivesAndUnregistersRedaction() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val activity = controller.get()
        val observer = RecordingAmbientObserver()
        lateinit var callback: AmbientLifecycleObserver.AmbientLifecycleCallback
        lateinit var state: AmbientRedaction
        var showRedaction by mutableStateOf(true)

        activity.setContent {
            CompositionLocalProvider(
                LocalAmbientObserverFactory provides { observedActivity, observedCallback ->
                    assertSame(activity, observedActivity)
                    callback = observedCallback
                    observer
                },
            ) {
                if (showRedaction) {
                    state = rememberAmbientRedaction(
                        phoneHidden = false,
                        hideAmounts = false,
                    )
                }
            }
        }

        compose.runOnIdle {
            assertEquals(1, observer.resumeCount)
            assertFalse(state.redacted)
            callback.onEnterAmbient(AmbientLifecycleObserver.AmbientDetails(false, false))
        }
        compose.runOnIdle {
            assertTrue(state.redacted)
            callback.onExitAmbient()
        }
        compose.runOnIdle {
            assertFalse(state.redacted)
            showRedaction = false
        }
        compose.waitForIdle()

        controller.pause()

        assertEquals(0, observer.pauseCount)
    }

    private fun assertRedacted(state: AmbientRedaction) {
        assertEquals(AmbientRedaction.DOTS, state.amount("0.5 BTC"))
        assertFalse(state.showsPriceLine(noPrice = false, pointCount = 48))
    }

    private class RecordingAmbientObserver : AmbientLifecycleObserver {
        var resumeCount = 0
        var pauseCount = 0

        override val isAmbient = false

        override fun onResume(owner: LifecycleOwner) {
            resumeCount++
        }

        override fun onPause(owner: LifecycleOwner) {
            pauseCount++
        }
    }
}
