// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.DataLayerClient
import io.xchain.wallet.android.wear.data.DataLayerNode
import io.xchain.wallet.android.wear.data.DataLayerSeam
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.DetailRequestIntent
import io.xchain.wallet.android.wear.data.MarkReadIntent
import io.xchain.wallet.android.wear.data.OpenOnPhoneIntent
import io.xchain.wallet.android.wear.data.RefreshIntent
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchStateIntent
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DataLayerClientTest {
    @Test
    fun readsSnapshotsFromMessagesAndDetailsFromChannels() {
        val client = DataLayerClient(FakeDataLayer())
        val snapshot = fixture("snapshot-empty.json")
        val detail = fixture("detail-cached.json")

        assertEquals(1, (client.readMessage("/xc/snapshot", snapshot) as Snapshot).v)
        assertEquals(
            "bitcoin-mainnet:XC",
            (client.readChannel("/xc/detail/bitcoin-mainnet:XC", ByteArrayInputStream(detail)) as Detail).tokenId,
        )
        assertEquals(null, client.readMessage("/xc/state", byteArrayOf()))
    }

    @Test
    fun sendsEveryIntentOnlyToTheNearbyPhone() = runBlocking {
        val seam = FakeDataLayer()
        val client = DataLayerClient(seam)

        assertTrue(client.sendIntent(RefreshIntent()))
        assertTrue(client.sendIntent(DetailRequestIntent("btc")))
        assertTrue(client.sendIntent(OpenOnPhoneIntent("request/a1")))
        assertTrue(client.sendIntent(MarkReadIntent("a1")))
        assertTrue(client.start("9.4.0"))

        assertEquals(List(5) { "nearby-phone" }, seam.sent.map { it.nodeId })
        assertEquals(
            listOf("refresh", "detailRequest", "openOnPhone", "markRead", "watchState")
                .map { "/xc/intent/$it" },
            seam.sent.map { it.path },
        )
        assertEquals("{\"appVersion\":\"9.4.0\"}", seam.sent.last().payload.decodeToString())
        assertEquals(List(5) { "xchain_phone" }, seam.requestedCapabilities)
    }

    @Test
    fun refusesToSendWithoutANearbyPhone() = runBlocking {
        val seam = FakeDataLayer(nodes = listOf(DataLayerNode("remote-phone", false)))

        assertFalse(DataLayerClient(seam).sendIntent(WatchStateIntent("9.4.0")))
        assertTrue(seam.sent.isEmpty())
    }

    private fun fixture(name: String): ByteArray =
        requireNotNull(javaClass.classLoader?.getResource(name)).readBytes()

    private data class Sent(val nodeId: String, val path: String, val payload: ByteArray)

    private class FakeDataLayer(
        private val nodes: List<DataLayerNode> = listOf(
            DataLayerNode("remote-phone", false),
            DataLayerNode("nearby-phone", true),
        ),
    ) : DataLayerSeam {
        val requestedCapabilities = mutableListOf<String>()
        val sent = mutableListOf<Sent>()

        override suspend fun nodes(capability: String): List<DataLayerNode> {
            requestedCapabilities += capability
            return nodes
        }

        override suspend fun sendMessage(nodeId: String, path: String, payload: ByteArray) {
            sent += Sent(nodeId, path, payload)
        }
    }
}
