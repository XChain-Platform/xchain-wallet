// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performScrollToNode
import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AlertDetailScreenSemanticsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json
    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun requestLinesExposeTheirSharedAccessibilityLabels() {
        val expected = mapOf(
            "request-confirm.json" to listOf(
                "Request, Confirm this Send request on your phone.",
                "Amount, 0.025 BTC",
            ),
            "request-expired.json" to listOf(
                "Request, This payment request has expired.",
                "Amount, 48.50 USDC",
                "This request expired.",
            ),
            "request-paydue.json" to listOf(
                "Request, Payment is due for this request.",
                "Amount, 125.00 USDC",
                "Expires, at:4102444800000",
            ),
        )
        val firstFixture = resource(expected.keys.first())
        val strings = listOf("strings-alerts.json", "strings-balances.json")
            .flatMap { name ->
                repositoryRoot(firstFixture)
                    .resolve("packages/core/src/watch/contract/$name")
                    .readText()
                    .let(json::parseToJsonElement)
                    .jsonObject
                    .map { (key, value) -> key to value.jsonPrimitive.content }
            }
            .toMap()

        expected.forEach { (fixture, wantedLabels) ->
            val request = json.decodeFromString<Request>(resource(fixture).readText())
            val display = AlertsPresenter.presentRequest(request, 1700000000000)
            activity.setContent {
                AlertDetailScreen(
                    alert = null,
                    request = display,
                    onOpenOnPhone = {},
                    text = { key -> strings.getValue(key) },
                    formatAt = { "at:$it" },
                )
            }

            val scrollable = compose.onNode(hasScrollToNodeAction())
            wantedLabels.forEach { label ->
                scrollable.performScrollToNode(hasContentDescription(label))
                compose.onNodeWithContentDescription(label).assertIsDisplayed()
            }
        }
    }

    private fun repositoryRoot(fixture: File): File =
        generateSequence(fixture.parentFile) { it.parentFile }
            .firstOrNull { it.resolve("test/fixtures/watch/request-confirm.json").isFile }
            ?: error("Repository root not found from $fixture")

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)
}
