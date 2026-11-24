// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.os.Parcel
import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.MessageEvent
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.sync.WatchListenerService
import java.io.ByteArrayInputStream
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
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

    @Before
    fun captureRefreshes() {
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
        service.onMessageReceived(message("/xc/snapshot", fixture("snapshot-empty.json")))

        assertEquals(1700000000000, SnapshotStore(service).latest?.get("builtAt")?.toString()?.toLong())
        assertEquals(1, refreshes)
    }

    @Test
    fun newerDisabledStateWipesAndRefreshesButStaleStateDoesNot() {
        service.onMessageReceived(message("/xc/snapshot", fixture("snapshot-empty.json")))
        val builtAt = checkNotNull(SnapshotStore(service).latest)["builtAt"]!!.toString().toLong()

        service.onStateItems(listOf(WatchListenerService.StateItem(false, builtAt - 1)))
        assertNotNull(SnapshotStore(service).latest)
        assertEquals(1, refreshes)

        service.onStateItems(listOf(WatchListenerService.StateItem(false, builtAt)))
        assertNull(SnapshotStore(service).latest)
        assertEquals(2, refreshes)
    }

    @Test
    fun detailAndImageMessagesAreStoredAndRefreshGlances() {
        val detail = fixture("detail-cached.json")
        val hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        service.onMessageReceived(message("/xc/detail/bitcoin-mainnet:XC", detail))
        assertEquals(1, refreshes)

        service.onMessageReceived(message("/xc/image/$hash", byteArrayOf(1, 2, 3)))
        assertEquals(2, refreshes)

        assertArrayEquals(detail, service.filesDir.resolve("watch/details/bitcoin-mainnet:XC").readBytes())
        assertArrayEquals(byteArrayOf(1, 2, 3), service.filesDir.resolve("watch/images/$hash").readBytes())
    }

    @Test
    fun detailAndImageChannelsAreStoredAndRefreshGlances() {
        val detailPath = "/xc/detail/bitcoin-mainnet:XC"
        val imagePath = "/xc/image/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        val payloads = mapOf(
            detailPath to fixture("detail-cached.json"),
            imagePath to byteArrayOf(4, 5, 6),
        )
        service.readChannel = { channel, consume ->
            consume(ByteArrayInputStream(checkNotNull(payloads[channel.path])))
        }

        service.onChannelOpened(channel(detailPath))
        assertEquals(1, refreshes)
        service.onChannelOpened(channel(imagePath))
        assertEquals(2, refreshes)

        val detailFile = service.filesDir.resolve("watch/details/bitcoin-mainnet:XC")
        val imageFile = service.filesDir.resolve("watch/images/${imagePath.substringAfterLast('/')}")
        assertArrayEquals(checkNotNull(payloads[detailPath]), detailFile.readBytes())
        assertArrayEquals(checkNotNull(payloads[imagePath]), imageFile.readBytes())
    }

    @Test
    fun ignoredMessageAndChannelPathsDoNotStoreOrRefresh() {
        service.readChannel = { _, consume -> consume(ByteArrayInputStream(byteArrayOf(7, 8, 9))) }

        service.onMessageReceived(message("/ignored", byteArrayOf(1)))
        service.onMessageReceived(message("/xc/state", byteArrayOf(2)))
        service.onChannelOpened(channel("/xc/image/not-a-hash"))
        service.onStateItems(listOf(WatchListenerService.StateItem(true, Long.MAX_VALUE)))

        assertEquals(0, refreshes)
        assertNull(SnapshotStore(service).latest)
        assertFalse(service.filesDir.resolve("watch/images/not-a-hash").exists())
    }

    private fun message(eventPath: String, payload: ByteArray): MessageEvent = object : MessageEvent {
        override fun getRequestId() = 1
        override fun getPath() = eventPath
        override fun getData() = payload
        override fun getSourceNodeId() = "phone"
    }

    private fun channel(channelPath: String): ChannelClient.Channel = object : ChannelClient.Channel {
        override fun getNodeId() = "phone"
        override fun getPath() = channelPath
        override fun describeContents() = 0
        override fun writeToParcel(destination: Parcel, flags: Int) = Unit
    }

    private fun fixture(name: String): ByteArray =
        checkNotNull(javaClass.classLoader?.getResource(name)).readBytes()
}
