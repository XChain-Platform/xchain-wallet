// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.xchain.wallet.android.wear.ui.AlertDisplay
import io.xchain.wallet.android.wear.ui.AlertRow
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
class AlertRowTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun unreadAlertTwoHoursOldShowsItsContentsAndDot() {
        show(alert(body = "Complete your payment", unread = true, at = NOW - 2 * HOUR))

        compose.onNodeWithText("Payment due").assertIsDisplayed()
        compose.onNodeWithText("Complete your payment").assertIsDisplayed()
        compose.onNodeWithText("2 h ago").assertIsDisplayed()
        compose.onNodeWithTag("alertUnreadDot", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun readAlertWithNullBodyShowsNoBodyOrDot() {
        show(alert(body = null, unread = false, at = NOW - HOUR))

        compose.onNodeWithText("Payment due").assertIsDisplayed()
        compose.onNodeWithText("1 h ago").assertIsDisplayed()
        compose.onNodeWithText("Complete your payment").assertDoesNotExist()
        compose.onNodeWithTag("alertUnreadDot", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun alertTwentySixHoursOldShowsOneDay() {
        show(alert(at = NOW - 26 * HOUR))

        compose.onNodeWithText("1 d ago").assertIsDisplayed()
    }

    @Test
    fun alertThirtySecondsOldShowsJustNow() {
        show(alert(at = NOW - 30_000L))

        compose.onNodeWithText("Just now").assertIsDisplayed()
    }

    @Test
    fun clickOpensAlertExactlyOnce() {
        var opens = 0
        show(alert(), onOpen = { opens++ })

        compose.onNodeWithText("Payment due").performClick()
        compose.runOnIdle { assertEquals(1, opens) }
    }

    private fun show(alert: AlertDisplay, onOpen: () -> Unit = {}) {
        activity.setContent { AlertRow(alert, NOW, onOpen, ::text) }
    }

    private fun alert(
        body: String? = "Complete your payment",
        unread: Boolean = false,
        at: Long = NOW,
    ) = AlertDisplay("alert-1", "paydue", "Payment due", body, at, unread)

    @Composable
    private fun text(key: String): String = mapOf(
        "w3.timeJustNow" to "Just now",
        "w3.timeMinutes" to "{n} min ago",
        "w3.timeHours" to "{n} h ago",
        "w3.timeDays" to "{n} d ago",
    ).getValue(key)

    private companion object {
        const val NOW = 1_700_000_000_000L
        const val HOUR = 3_600_000L
    }
}
