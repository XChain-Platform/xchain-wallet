// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.nav.BalancesDestination
import io.xchain.wallet.android.wear.nav.WatchNavActions
import io.xchain.wallet.android.wear.nav.WatchNavGraph
import io.xchain.wallet.android.wear.nav.WatchNavRoutes
import io.xchain.wallet.android.wear.nav.WatchScreenGraph
import io.xchain.wallet.android.wear.nav.WatchScreenGraph.Screen
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import java.io.File
import kotlinx.serialization.json.Json
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
class WatchNavTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun balanceRowDispatchesItsTokenId() {
        val snapshot = fixture("snapshot-capped.json")
        val opened = mutableListOf<String>()
        activity.setContent {
            MaterialTheme {
                BalancesDestination(
                    snapshot = snapshot,
                    display = BalancesPresenter.present(snapshot, now = snapshot.builtAt),
                    mode = UnitsMode.FIAT,
                    isTestNetwork = false,
                    unread = 0,
                    onModeChange = {},
                    onToken = opened::add,
                    onAlerts = {},
                    onReceive = {},
                    onStatus = {},
                    onRequest = null,
                    text = ::testText,
                )
            }
        }

        compose.onNodeWithText("Token 01").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("bitcoin-mainnet:T01"), opened) }
    }

    @Test
    fun navigationActionsProduceEveryPushAndPreserveDetailIds() {
        val routes = mutableListOf<String>()
        val actions = WatchNavActions(routes::add)

        actions.tokenDetail("bitcoin-mainnet:T01")
        actions.alerts()
        actions.alertDetail("request/42")
        actions.receive()
        actions.status()

        assertEquals("bitcoin-mainnet:T01", WatchNavRoutes.argument(routes[0], Screen.TOKEN_DETAIL))
        assertEquals(Screen.ALERTS.route(), routes[1])
        assertEquals("request/42", WatchNavRoutes.argument(routes[2], Screen.ALERT_DETAIL))
        assertEquals(Screen.RECEIVE.route(), routes[3])
        assertEquals(Screen.STATUS.route(), routes[4])
    }

    @Test
    fun swipeDismissableGraphHostsEveryPushDestination() {
        lateinit var actions: WatchNavActions
        activity.setContent {
            MaterialTheme {
                WatchNavGraph(
                    startDestination = Screen.BALANCES.route(),
                    balances = {
                        actions = it
                        Text("balances destination")
                    },
                    tokenDetail = { Text("token destination $it") },
                    alerts = { Text("alerts destination") },
                    alertDetail = { Text("alert destination $it") },
                    receive = { Text("receive destination") },
                    status = { Text("status destination") },
                    notSetUp = { Text("not set up destination") },
                )
            }
        }

        compose.onNodeWithText("balances destination").assertIsDisplayed()
        compose.runOnIdle { actions.tokenDetail("bitcoin-mainnet:T01") }
        compose.onNodeWithText("token destination bitcoin-mainnet:T01").assertIsDisplayed()
        compose.runOnIdle { actions.alerts() }
        compose.onNodeWithText("alerts destination").assertIsDisplayed()
        compose.runOnIdle { actions.alertDetail("request/42") }
        compose.onNodeWithText("alert destination request/42").assertIsDisplayed()
        compose.runOnIdle { actions.receive() }
        compose.onNodeWithText("receive destination").assertIsDisplayed()
        compose.runOnIdle { actions.status() }
        compose.onNodeWithText("status destination").assertIsDisplayed()
    }

    @Test
    fun swipeDismissableGraphHostsNotSetUpRoot() {
        activity.setContent {
            MaterialTheme {
                WatchNavGraph(
                    startDestination = Screen.NOT_SET_UP.route(),
                    balances = {},
                    tokenDetail = {},
                    alerts = {},
                    alertDetail = {},
                    receive = {},
                    status = {},
                    notSetUp = { Text("not set up destination") },
                )
            }
        }

        compose.onNodeWithText("not set up destination").assertIsDisplayed()
    }

    @Test
    fun rootSelectionMatchesSnapshotAvailabilityAndSetting() {
        assertEquals(Screen.NOT_SET_UP, WatchScreenGraph.root(false, true))
        assertEquals(Screen.NOT_SET_UP, WatchScreenGraph.root(true, false))
        assertEquals(Screen.BALANCES, WatchScreenGraph.root(true, true))
    }

    @Test
    fun mainActivityDeclaresItsComposeLifecycleEntryPoint() {
        assertTrue(ComponentActivity::class.java.isAssignableFrom(MainActivity::class.java))
        MainActivity::class.java.getDeclaredMethod("onCreate", Bundle::class.java)
    }

    private fun fixture(name: String): Snapshot =
        Json.decodeFromString(resource(name).readText())

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)

    @androidx.compose.runtime.Composable
    private fun testText(key: String): String = mapOf(
        "state.age" to "Updated just now",
        "state.ageAmber" to "Updated just now",
        "state.moreOnPhone" to "More on phone",
        "state.status" to "Status",
        "w1.receive" to "Receive",
        "w3.title" to "Alerts",
    ).getValue(key)
}
