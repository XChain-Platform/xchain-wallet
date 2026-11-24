// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import io.xchain.wallet.android.wear.data.MarkReadIntent
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.ui.AlertDisplay
import io.xchain.wallet.android.wear.ui.AlertsDisplay
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.AlertsScreen
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
@Config(sdk = [35])
class AlertsScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun showsAlertsNewestFirst() {
        show(
            AlertsPresenter.present(
                inbox = listOf(
                    inbox("older", "Older alert", NOW - 2_000L),
                    inbox("newer", "Newer alert", NOW - 1_000L),
                ),
                request = null,
                now = NOW,
            ),
        )

        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("Newer alert").assertIsDisplayed()
        compose.onNodeWithText("Older alert").performScrollTo().assertIsDisplayed()
        val newer = compose.onNodeWithText("Newer alert").fetchSemanticsNode().boundsInRoot.top
        val older = compose.onNodeWithText("Older alert").fetchSemanticsNode().boundsInRoot.top
        assertTrue("Newer alert should be above older alert", newer < older)
    }

    @Test
    fun emptyInboxShowsEmptyTextWithoutUnreadDot() {
        show(AlertsPresenter.present(emptyList(), request = null, now = NOW))

        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("No alerts").assertIsDisplayed()
        compose.onNodeWithTag("alertUnreadDot", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun capsRenderedRowsAtTwentyAndShowsUnreadDot() {
        val rows = List(21) { index ->
            AlertDisplay(
                id = "alert-$index",
                family = "messages",
                title = "Alert $index",
                body = "Body $index",
                at = NOW - index,
                unread = index == 0,
            )
        }
        show(AlertsDisplay(rows, emptyTextKey = null, request = null))

        compose.onNodeWithTag("alertUnreadDot", useUnmergedTree = true).assertIsDisplayed()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Alert 19"))
        compose.onNodeWithText("Alert 19").assertIsDisplayed()
        compose.onNodeWithText("Alert 20").assertDoesNotExist()
    }

    @Test
    fun clickingRowMarksItReadThenOpensItExactlyOnce() {
        val events = mutableListOf<String>()
        val display = AlertsPresenter.present(
            listOf(inbox("alert-1", "Payment due", NOW)),
            request = null,
            now = NOW,
        )
        show(
            display,
            markRead = { events += "mark:${it.id}" },
            onOpen = { events += "open:$it" },
        )

        compose.onNodeWithText("Payment due").performClick()

        compose.runOnIdle {
            assertEquals(listOf("mark:alert-1", "open:alert-1"), events)
        }
    }

    private fun show(
        display: AlertsDisplay,
        markRead: (MarkReadIntent) -> Unit = {},
        onOpen: (String) -> Unit = {},
    ) {
        activity.setContent {
            AlertsScreen(display, NOW, markRead, onOpen, ::text)
        }
    }

    private fun inbox(id: String, title: String, at: Long, read: Boolean = false) =
        SnapshotInboxItem(id, "messages", "message", title, "Body", at, read)

    @Composable
    private fun text(key: String): String = mapOf(
        "w3.title" to "Alerts",
        "w3.empty" to "No alerts",
        "w3.timeJustNow" to "Just now",
        "w3.timeMinutes" to "{n} min ago",
        "w3.timeHours" to "{n} h ago",
        "w3.timeDays" to "{n} d ago",
    ).getValue(key)

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}
