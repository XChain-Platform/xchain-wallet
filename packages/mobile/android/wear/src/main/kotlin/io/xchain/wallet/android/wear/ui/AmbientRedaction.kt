package io.xchain.wallet.android.wear.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.wear.ambient.AmbientLifecycleObserver
import io.xchain.wallet.android.wear.data.WatchDisplayRules

class AmbientRedaction internal constructor(val redacted: Boolean) {
    fun amount(text: String): String = if (redacted) DOTS else text

    fun showsPriceLine(noPrice: Boolean, pointCount: Int): Boolean =
        WatchDisplayRules.showsPriceLine(redacted, noPrice, pointCount)

    companion object {
        const val DOTS = "••••"
    }
}

internal val LocalAmbientObserverFactory = staticCompositionLocalOf<(
    ComponentActivity,
    AmbientLifecycleObserver.AmbientLifecycleCallback,
) -> AmbientLifecycleObserver> {
    { activity, callback ->
        AmbientLifecycleObserver(activity, callback)
    }
}

@Composable
fun rememberAmbientRedaction(phoneHidden: Boolean, hideAmounts: Boolean): AmbientRedaction {
    val activity = LocalContext.current as ComponentActivity
    val observerFactory = LocalAmbientObserverFactory.current
    var ambient by remember { mutableStateOf(false) }
    DisposableEffect(activity, observerFactory) {
        val callback = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
                ambient = true
            }

            override fun onExitAmbient() {
                ambient = false
            }
        }
        val observer = observerFactory(activity, callback)
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
    }
    return ambientRedaction(ambient, phoneHidden, hideAmounts)
}

internal fun ambientRedaction(
    ambient: Boolean,
    phoneHidden: Boolean,
    hideAmounts: Boolean,
): AmbientRedaction = AmbientRedaction(WatchDisplayRules.isRedacted(ambient, phoneHidden, hideAmounts))
