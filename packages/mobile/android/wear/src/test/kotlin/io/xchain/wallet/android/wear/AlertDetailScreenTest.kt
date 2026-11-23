// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.xchain.wallet.android.wear.ui.AlertDetailLine
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertDisplay
import io.xchain.wallet.android.wear.ui.AlertDisplayValue
import io.xchain.wallet.android.wear.ui.RequestDisplay
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
class AlertDetailScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun showsTheFullAlertAndOpensItOnThePhone() {
        var opens = 0
        activity.setContent {
            AlertDetailScreen(
                alert = AlertDisplay(
                    id = "alert-1",
                    family = "messages",
                    title = "Message received",
                    body = "The complete alert body stays available without one-line truncation.",
                    at = 1_700_000_000_000L,
                    unread = true,
                ),
                request = null,
                onOpenOnPhone = { opens++ },
                text = ::text,
                formatAt = { "Nov 14, 10:13 PM" },
            )
        }

        compose.onNodeWithContentDescription("MessageIcon").assertIsDisplayed()
        compose.onNodeWithText("Message received").assertIsDisplayed()
        compose.onNodeWithText(
            "The complete alert body stays available without one-line truncation.",
        ).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Nov 14, 10:13 PM").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open on phone").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, opens) }
    }

    @Test
    fun showsPendingRequestSentenceAmountAndExpiry() {
        activity.setContent {
            AlertDetailScreen(
                alert = null,
                request = RequestDisplay(
                    pinned = AlertDisplayValue(key = "w1.requestWaiting"),
                    lines = listOf(
                        line("w4.requestSentence", text = "Review this payment"),
                        line("w4.requestAmount", text = "2 XC"),
                        line("w4.requestExpiry", at = 1_700_000_000_000L),
                    ),
                ),
                onOpenOnPhone = {},
                text = ::text,
                formatAt = { "Nov 14, 10:13 PM" },
            )
        }

        compose.onNodeWithContentDescription("DocumentIcon").assertIsDisplayed()
        listOf("Request", "Review this payment", "Amount", "2 XC", "Expires").forEach {
            compose.onNodeWithText(it).performScrollTo().assertIsDisplayed()
        }
        compose.onNodeWithText("Nov 14, 10:13 PM").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open on phone").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun showsExpiredRequestSentence() {
        activity.setContent {
            AlertDetailScreen(
                alert = null,
                request = RequestDisplay(
                    pinned = AlertDisplayValue(key = "w1.requestWaiting"),
                    lines = listOf(
                        AlertDetailLine(null, AlertDisplayValue(key = "w4.requestExpired")),
                    ),
                ),
                onOpenOnPhone = {},
                text = ::text,
                formatAt = { error("Expired requests have no formatted expiry") },
            )
        }

        compose.onNodeWithText("This request expired.").performScrollTo().assertIsDisplayed()
    }

    private fun line(key: String, text: String? = null, at: Long? = null) = AlertDetailLine(
        label = AlertDisplayValue(key = key),
        value = AlertDisplayValue(text = text, at = at),
    )

    @Composable
    private fun text(key: String): String = mapOf(
        "w4.title" to "Alert detail",
        "w4.openOnPhone" to "Open on phone",
        "w4.requestSentence" to "Request",
        "w4.requestAmount" to "Amount",
        "w4.requestExpired" to "This request expired.",
        "w4.requestExpiry" to "Expires",
    ).getValue(key)
}
