// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.data.SnapshotReceive
import io.xchain.wallet.android.wear.data.SnapshotRow
import io.xchain.wallet.android.wear.data.SnapshotSettings
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchContractBlocksTest {
    @Test
    fun decodesEverySnapshotBlockAndKeepsEveryValue() {
        val row = Json.decodeFromString<SnapshotRow>(
            """{
                "id":"btc-main","chainId":"bitcoin","tick":"BTC","displayName":"Bitcoin",
                "amountText":"1.25000000","fiatText":"$125,000.00","noPrice":false,
                "pendingText":"0.01000000 pending","unavailable":true,"iconHash":"abc123",
                "tickerColor":"#F7931A","hasDetail":true
            }""".trimIndent(),
        )
        assertEquals("btc-main", row.id)
        assertEquals("bitcoin", row.chainId)
        assertEquals("BTC", row.tick)
        assertEquals("Bitcoin", row.displayName)
        assertEquals("1.25000000", row.amountText)
        assertEquals("$125,000.00", row.fiatText)
        assertFalse(row.noPrice)
        assertEquals("0.01000000 pending", row.pendingText)
        assertTrue(row.unavailable)
        assertEquals("abc123", row.iconHash)
        assertEquals("#F7931A", row.tickerColor)
        assertTrue(row.hasDetail)

        val receive = Json.decodeFromString<SnapshotReceive>(
            """{
                "chainId":"ethereum","label":"Ethereum","address":"0x1234",
                "qr":{"size":21,"bits":"AQID"}
            }""".trimIndent(),
        )
        assertEquals("ethereum", receive.chainId)
        assertEquals("Ethereum", receive.label)
        assertEquals("0x1234", receive.address)
        assertEquals(21, receive.qr.size)
        assertEquals("AQID", receive.qr.bits)

        val inbox = Json.decodeFromString<SnapshotInboxItem>(
            """{
                "id":"notice-1","family":"incomingReceipts","kind":"received",
                "title":"Payment received","body":"Received 0.5 BTC",
                "at":1732147200000,"read":false
            }""".trimIndent(),
        )
        assertEquals("notice-1", inbox.id)
        assertEquals("incomingReceipts", inbox.family)
        assertEquals("received", inbox.kind)
        assertEquals("Payment received", inbox.title)
        assertEquals("Received 0.5 BTC", inbox.body)
        assertEquals(1732147200000L, inbox.at)
        assertFalse(inbox.read)

        val settings = Json.decodeFromString<SnapshotSettings>(
            """{"showTotal":true,"enabled":false}""",
        )
        assertTrue(settings.showTotal)
        assertFalse(settings.enabled)
    }

    @Test
    fun rejectsRowMissingRequiredHasDetail() {
        assertThrows(SerializationException::class.java) {
            Json.decodeFromString<SnapshotRow>(
                """{
                    "id":"btc-main","chainId":"bitcoin","tick":"BTC","displayName":"Bitcoin",
                    "amountText":"1.25000000","fiatText":"$125,000.00","noPrice":false,
                    "pendingText":"","unavailable":false,"iconHash":"abc123","tickerColor":"#F7931A"
                }""".trimIndent(),
            )
        }
    }

    @Test
    fun rejectsStringInboxTimestamp() {
        assertThrows(SerializationException::class.java) {
            Json.decodeFromString<SnapshotInboxItem>(
                """{
                    "id":"notice-1","family":"messages","kind":"message","title":"New message",
                    "body":"Hello","at":"1732147200000","read":false
                }""".trimIndent(),
            )
        }
    }
}
