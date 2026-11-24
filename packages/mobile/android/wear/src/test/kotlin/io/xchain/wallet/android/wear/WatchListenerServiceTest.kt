// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.sync.WatchListenerService
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WatchListenerServiceTest {
    private val service = Robolectric.buildService(WatchListenerService::class.java).create().get()
    private var refreshes = 0

    init {
        WatchListenerService.refresh = { refreshes++ }
    }

    @After
    fun resetRefresh() {
        WatchListenerService.refresh = {
            io.xchain.wallet.android.wear.tile.BalanceTileService.onSnapshot(it)
            io.xchain.wallet.android.wear.complication.WalletComplicationService.onSnapshot(it)
        }
    }

    @Test
    fun snapshotMessagePersistsAndRefreshesGlances() {
        service.receive("/xc/snapshot", fixture("snapshot-empty.json"))

        assertNotNull(SnapshotStore(service).latest)
        assertEquals(1, refreshes)
    }

    @Test
    fun newerDisabledStateWipesAndRefreshesButStaleStateDoesNot() {
        service.receive("/xc/snapshot", fixture("snapshot-empty.json"))
        val builtAt = checkNotNull(SnapshotStore(service).latest)["builtAt"]!!.toString().toLong()

        service.receiveState(false, builtAt - 1)
        assertNotNull(SnapshotStore(service).latest)
        assertEquals(1, refreshes)

        service.receiveState(false, builtAt)
        assertNull(SnapshotStore(service).latest)
        assertEquals(2, refreshes)
    }

    @Test
    fun channelPayloadsAreStoredAndRefreshGlances() {
        val detail = fixture("detail-cached.json")
        val hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        service.receive("/xc/detail/bitcoin-mainnet:XC", detail)
        assertEquals(1, refreshes)

        service.receive("/xc/image/$hash", byteArrayOf(1, 2, 3))
        assertEquals(2, refreshes)

        assertArrayEquals(detail, service.filesDir.resolve("watch/details/bitcoin-mainnet:XC").readBytes())
        assertArrayEquals(byteArrayOf(1, 2, 3), service.filesDir.resolve("watch/images/$hash").readBytes())
    }

    private fun fixture(name: String): ByteArray =
        checkNotNull(javaClass.classLoader?.getResource(name)).readBytes()
}
