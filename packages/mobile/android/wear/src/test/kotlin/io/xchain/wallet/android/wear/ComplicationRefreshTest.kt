// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import io.xchain.wallet.android.wear.complication.WalletComplicationService
import io.xchain.wallet.android.wear.tile.TileRefresher
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComplicationRefreshTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var originalRefresher: TileRefresher
    private lateinit var originalRequestAll: (Context) -> Unit

    @Before
    fun saveSeams() {
        originalRefresher = WalletComplicationService.refresher
        originalRequestAll = WalletComplicationService.requestAll
    }

    @After
    fun restoreSeams() {
        WalletComplicationService.refresher = originalRefresher
        WalletComplicationService.requestAll = originalRequestAll
    }

    @Test
    fun refreshesAtMostOncePerFiveMinutesAndTheLastSnapshotWins() {
        var clock = 1_000L
        val scheduled = mutableListOf<Pair<Long, Runnable>>()
        val requests = mutableListOf<Context>()
        val secondContext = ContextWrapper(context)
        val thirdContext = ContextWrapper(context)
        WalletComplicationService.refresher = TileRefresher(
            now = { clock },
            schedule = { delayMs, task -> scheduled += delayMs to task },
        )
        WalletComplicationService.requestAll = { requests += it }

        WalletComplicationService.onSnapshot(context)
        assertEquals(listOf(context), requests)

        clock = 2_000L
        WalletComplicationService.onSnapshot(secondContext)
        clock = 3_000L
        WalletComplicationService.onSnapshot(thirdContext)

        assertEquals(listOf(context), requests)
        assertEquals(listOf(299_000L), scheduled.map { it.first })

        clock = 301_000L
        scheduled.single().second.run()
        assertEquals(2, requests.size)
        assertSame(thirdContext, requests.last())
    }

    @Test
    fun defaultRefresherIsATileRefresher() {
        assertEquals(TileRefresher::class, WalletComplicationService.refresher::class)
    }
}
