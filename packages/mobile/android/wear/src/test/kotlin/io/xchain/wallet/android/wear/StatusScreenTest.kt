package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.xchain.wallet.android.wear.ui.StatusRows
import io.xchain.wallet.android.wear.ui.StatusScreen
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StatusScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun rendersFixedStatusRowsAndTogglesHideAmounts() {
        var hideAmounts = false
        val now = 1_800_000_000_000L
        activity.setContent {
            StatusScreen(
                rows = StatusRows.rows(true, now - 12 * 60_000L, "unlocked", false, "1.2.3"),
                onHideAmountsChange = { hideAmounts = it },
                now = now,
                text = ::text,
            )
        }

        compose.onNodeWithText("Status").assertIsDisplayed()
        compose.onNodeWithText("Phone reachable").assertIsDisplayed()
        compose.onNodeWithText("Updated 12 min ago").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Hide amounts").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(true, hideAmounts) }
        compose.onNodeWithText("1.2.3").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun rendersUnreachableAndUnknownSessionStates() {
        activity.setContent {
            StatusScreen(
                rows = StatusRows.rows(false, null, "locked", true, "2.0"),
                onHideAmountsChange = {},
                text = ::text,
            )
        }

        compose.onNodeWithText("Phone not in range").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Session unknown").performScrollTo().assertIsDisplayed()
    }

    @Composable
    private fun text(key: String): String = mapOf(
        "state.status" to "Status",
        "state.phoneReachable" to "Phone reachable",
        "state.lastSync" to "Last sync",
        "state.session" to "Session",
        "state.hideAmounts" to "Hide amounts",
        "state.version" to "Version",
        "state.sessionUnknown" to "Session unknown",
        "state.locked" to "Wallet locked on phone",
        "state.unreachable" to "Phone not in range",
        "state.ageJustNow" to "Updated just now",
        "state.ageMinutes" to "Updated {n} min ago",
        "state.ageHours" to "Updated {n} h ago",
        "state.stale24h" to "Open XChain Wallet on your phone to refresh",
    ).getValue(key)
}
