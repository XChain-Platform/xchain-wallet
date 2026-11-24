// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.ui.AccessibilityLabels
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class AccessibilityRequestLabelsTest {
    private val json = Json

    @Test
    fun requestFixturesHaveTheirSharedAccessibilityLabels() {
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
        val text: (String) -> String = strings::getValue
        val time: (Long) -> String = { at -> "at:$at" }

        expected.forEach { (fixture, wantedLines) ->
            val request = json.decodeFromString<Request>(resource(fixture).readText())
            val display = AlertsPresenter.presentRequest(request, 1700000000000)

            assertEquals(
                fixture,
                "1 request waiting",
                AccessibilityLabels.requestPinned(display, text),
            )
            assertEquals(
                fixture,
                wantedLines,
                AccessibilityLabels.requestLines(display, text, time),
            )
        }
    }

    private fun repositoryRoot(fixture: File): File =
        generateSequence(fixture.parentFile) { it.parentFile }
            .firstOrNull { it.resolve("test/fixtures/watch/request-confirm.json").isFile }
            ?: error("Repository root not found from $fixture")

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)
}
