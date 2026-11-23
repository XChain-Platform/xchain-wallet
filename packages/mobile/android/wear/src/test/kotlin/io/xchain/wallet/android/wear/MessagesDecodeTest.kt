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
import io.xchain.wallet.android.wear.data.DetailChart
import io.xchain.wallet.android.wear.data.DetailFact
import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.RequestKind
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class MessagesDecodeTest {
    @Test
    fun decodesEveryRequestFixture() {
        val expected = mapOf(
            "request-confirm.json" to Request(
                "1023456789abcdef0123456789abcdef",
                RequestKind.REQUEST,
                "0a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef",
                "Confirm this Send request on your phone.",
                "0.025 BTC",
            ),
            "request-paydue.json" to Request(
                "2123456789abcdef0123456789abcdef",
                RequestKind.PAYDUE,
                "1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0a",
                "Payment is due for this request.",
                "125.00 USDC",
                4102444800000L,
            ),
            "request-expired.json" to Request(
                "3123456789abcdef0123456789abcdef",
                RequestKind.PAYDUE,
                "2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0a1b",
                "This payment request has expired.",
                "48.50 USDC",
                946684800000L,
            ),
        )

        expected.forEach { (fixture, request) ->
            assertEquals(fixture, request, decodeFixture<Request>(fixture))
        }
    }

    @Test
    fun decodesEveryDetailFixture() {
        val facts = listOf(
            DetailFact("Type", "Token"),
            DetailFact("Supply", "1,000,000 XC"),
            DetailFact("Divisibility", "6 decimals"),
            DetailFact("Status", "Mutable"),
            DetailFact("Creator", "xc1qab...7pq999"),
        )
        val description =
            "A cached token used to verify that watch detail screens render phone-formatted facts and descriptions."
        val expected = mapOf(
            "detail-native.json" to Detail(
                v = 1,
                tokenId = "bitcoin-mainnet:BTC",
                changeText = "-6.25% over 24 h",
                priceSourceText = "CoinGecko",
                chart = DetailChart(
                    points = List(48) { 48_000.0 - (it * 500) },
                    up = false,
                ),
            ),
            "detail-cached.json" to Detail(
                v = 1,
                tokenId = "bitcoin-mainnet:XC",
                artworkHash = "xc-artwork-cache",
                changeText = "+4.75% over 24 h",
                priceSourceText = "XChain DEX",
                facts = facts,
                description = description,
            ),
            "detail-noart.json" to Detail(
                v = 1,
                tokenId = "bitcoin-mainnet:XC",
                changeText = "+4.75% over 24 h",
                priceSourceText = "XChain DEX",
                facts = facts,
                description = description,
            ),
            "detail-loaderror.json" to Detail(
                v = 1,
                tokenId = "bitcoin-mainnet:LOADERROR",
            ),
        )

        expected.forEach { (fixture, detail) ->
            assertEquals(fixture, detail, decodeFixture<Detail>(fixture))
        }
    }

    private inline fun <reified T> decodeFixture(name: String): T {
        val resource = checkNotNull(javaClass.classLoader?.getResource(name))
        return Json.decodeFromString(resource.readText())
    }
}
