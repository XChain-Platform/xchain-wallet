// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.RequestDisplay
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertsPresenterTest {
    private val json = Json

    @Test
    fun everyRequestFixtureMatchesTheSharedDisplayModel() {
        val expected = expectedRequestJson()
        val now = expected.getValue("now").jsonPrimitive.long
        val fixtures = requestFixtures()

        assertEquals(
            expected.keys.filterNot { it == "now" }.sorted(),
            fixtures.map { it.nameWithoutExtension },
        )
        fixtures.forEach { file ->
            val request = json.decodeFromString<Request>(file.readText())
            val expectedDisplay = json.decodeFromJsonElement<RequestDisplay>(
                expected.getValue(file.nameWithoutExtension),
            )

            val display = AlertsPresenter.present(emptyList(), request, now)
            assertEquals(file.name, expectedDisplay, display.request)
        }
    }

    @Test
    fun alertRowsAreNewestFirstCappedAndReadyForBothScreens() {
        val inbox = List(22) { index ->
            SnapshotInboxItem(
                id = "alert-$index",
                family = "messages",
                kind = "message",
                title = "Alert $index",
                body = if (index == 21) "  " else "Body $index",
                at = index.toLong(),
                read = index % 2 == 0,
            )
        }

        val display = AlertsPresenter.present(inbox, request = null, now = 22)

        assertEquals(20, display.rows.size)
        assertEquals("alert-21", display.rows.first().id)
        assertEquals("alert-2", display.rows.last().id)
        assertNull(display.rows.first().body)
        assertTrue(display.rows.first().unread)
        assertNull(display.emptyTextKey)
        assertNull(display.request)
    }

    @Test
    fun emptyInboxUsesTheW3EmptyText() {
        val display = AlertsPresenter.present(emptyList(), request = null, now = 0)

        assertEquals("w3.empty", display.emptyTextKey)
        assertTrue(display.rows.isEmpty())
        assertFalse(display.rows.any { it.unread })
    }

    private fun expectedRequestJson() =
        checkNotNull(javaClass.classLoader?.getResource("expected/request.json"))
            .readText()
            .let(json::parseToJsonElement)
            .jsonObject

    private fun requestFixtures(): List<File> {
        val first = checkNotNull(javaClass.classLoader?.getResource("request-confirm.json"))
            .toURI()
            .let(::File)
        return requireNotNull(requireNotNull(first.parentFile).listFiles())
            .filter { it.isFile && it.name.startsWith("request-") && it.extension == "json" }
            .sortedBy { it.name }
            .also { assertTrue("No request fixtures found", it.isNotEmpty()) }
    }
}
