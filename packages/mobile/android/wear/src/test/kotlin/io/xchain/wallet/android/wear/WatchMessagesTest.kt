// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.MarkReadIntent
import io.xchain.wallet.android.wear.data.RefreshIntent
import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.RequestKind
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class WatchMessagesTest {
    @Test
    fun requestKindsAndOptionalExpiryDecode() {
        val request = Json.decodeFromString<Request>(
            """{"id":"00112233445566778899aabbccddeeff","kind":"request","iconHash":"h1","sentence":"Review request","amountText":"1 XCH"}""",
        )
        val paydue = Json.decodeFromString<Request>(
            """{"id":"ffeeddccbbaa99887766554433221100","kind":"paydue","iconHash":"h2","sentence":"Payment due","amountText":"2 XCH","expiresAt":1730000000000}""",
        )

        assertEquals(RequestKind.REQUEST, request.kind)
        assertNull(request.expiresAt)
        assertEquals(RequestKind.PAYDUE, paydue.kind)
        assertEquals(1730000000000L, paydue.expiresAt)
    }

    @Test
    fun unknownRequestKindThrows() {
        assertThrows(SerializationException::class.java) {
            Json.decodeFromString<Request>(
                """{"id":"00112233445566778899aabbccddeeff","kind":"other","iconHash":"h1","sentence":"Review request","amountText":"1 XCH"}""",
            )
        }
    }

    @Test
    fun absentDetailKeysDecodeAsNull() {
        val detail = Json.decodeFromString<Detail>("""{"v":1,"tokenId":"btc"}""")

        assertNull(detail.artworkHash)
        assertNull(detail.changeText)
        assertNull(detail.priceSourceText)
        assertNull(detail.chart)
        assertNull(detail.facts)
        assertNull(detail.description)
    }

    @Test
    fun chartKeepsAllFortyEightPointsInOrder() {
        val points = List(48) { index -> index.toDouble() / 2 }
        val detail = Json.decodeFromString<Detail>(
            """{"v":1,"tokenId":"btc","chart":{"points":[${points.joinToString()}],"up":true}}""",
        )

        assertEquals(points, detail.chart?.points)
    }

    @Test
    fun intentsEncodeWithOnlyTheirSchemaFields() {
        assertEquals("""{"id":"a1"}""", Json.encodeToString(MarkReadIntent("a1")))
        assertEquals("{}", Json.encodeToString(RefreshIntent()))
    }
}
