// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import io.xchain.wallet.android.wear.ui.BalancesScreen
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w227dp-h227dp-round-watch-xhdpi")
class BalancesScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun rendersPresenterModelAndRoutesHeadControls() {
        val taps = mutableListOf<String>()
        activity.setContent {
            screen(
                unread = 2,
                onAlerts = { taps += "alerts" },
                onReceive = { taps += "receive" },
                onStatus = { taps += "status" },
                onRequest = { taps += "request" },
            )
        }

        listOf("Alerts", "Receive", "Status").forEach { label ->
            compose.onNodeWithText(label).assertIsDisplayed().performClick()
        }
        compose.onNodeWithText("•").assertIsDisplayed()
        compose.onNodeWithText("\$64,000.00").assertIsDisplayed()
        compose.onNodeWithText("1 request waiting").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Bitcoin").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("\$63,000.00").assertIsDisplayed()
        compose.runOnIdle { assertEquals(listOf("alerts", "receive", "status", "request"), taps) }
    }

    @Test
    fun headerTogglesModesExceptOnTestNetworks() {
        val modes = mutableListOf<UnitsMode>()
        activity.setContent { screen(onModeChange = modes::add) }
        compose.onNodeWithText("\$64,000.00").performClick()
        compose.runOnIdle { assertEquals(listOf(UnitsMode.UNITS), modes) }

        activity.setContent { screen(mode = UnitsMode.UNITS, onModeChange = modes::add) }
        compose.onNodeWithText("\$64,000.00").performClick()
        compose.runOnIdle { assertEquals(listOf(UnitsMode.UNITS, UnitsMode.FIAT), modes) }

        activity.setContent { screen(isTestNetwork = true, onModeChange = modes::add) }
        compose.onNodeWithText("\$64,000.00").performClick()
        compose.runOnIdle { assertEquals(listOf(UnitsMode.UNITS, UnitsMode.FIAT), modes) }
    }

    @Test
    fun usesTransformingListWithRotaryScrolling() {
        val source = repoFile(
            "packages/mobile/android/wear/src/main/kotlin/" +
                "io/xchain/wallet/android/wear/ui/BalancesScreen.kt",
        ).readText()

        assertTrue(Regex("""\bTransformingLazyColumn\s*\(""").containsMatchIn(source))
        assertTrue(
            Regex(
                """rotaryScrollableBehavior\s*=\s*""" +
                    """RotaryScrollableDefaults\.behavior\(state\)""",
            ).containsMatchIn(source),
        )
    }

    @Composable
    private fun screen(
        unread: Int = 0,
        mode: UnitsMode = UnitsMode.FIAT,
        isTestNetwork: Boolean = false,
        onModeChange: (UnitsMode) -> Unit = {},
        onAlerts: () -> Unit = {},
        onReceive: () -> Unit = {},
        onStatus: () -> Unit = {},
        onRequest: (() -> Unit)? = null,
    ) = BalancesScreen(
        display = BalancesDisplay(
            header = BalanceText(text = "\$64,000.00"),
            lines = listOf(
                BalanceLine(
                    name = "Bitcoin",
                    primary = BalanceText(text = "\$63,000.00"),
                    secondary = BalanceText(text = "1 BTC"),
                ),
            ),
            banners = emptyList(),
            ageLine = null,
            requestKey = "w1.requestWaiting",
        ),
        mode = mode,
        isTestNetwork = isTestNetwork,
        unread = unread,
        onModeChange = onModeChange,
        onAlerts = onAlerts,
        onReceive = onReceive,
        onStatus = onStatus,
        onRequest = onRequest,
        text = ::text,
    )

    @Composable
    private fun text(key: String): String = mapOf(
        "state.age" to "Updated 12 min ago",
        "state.ageAmber" to "Updated 12 min ago",
        "state.status" to "Status",
        "w1.receive" to "Receive",
        "w1.requestWaiting" to "1 request waiting",
        "w3.title" to "Alerts",
    ).getValue(key)

    private fun repoFile(path: String): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        repeat(8) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile ?: return@repeat
        }
        throw AssertionError("Missing repository file: $path")
    }
}
