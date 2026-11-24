package io.xchain.wallet.android.wear.sync

import com.google.android.gms.wearable.ChannelClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import io.xchain.wallet.android.wear.complication.WalletComplicationService
import io.xchain.wallet.android.wear.data.ImageCache
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.data.WatchPaths
import io.xchain.wallet.android.wear.tile.BalanceTileService
import java.io.File
import java.io.InputStream
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

class WatchListenerService : WearableListenerService() {
    internal data class StateItem(val enabled: Boolean, val builtAt: Long)

    internal var readChannel: (ChannelClient.Channel, (InputStream) -> Unit) -> Unit = { channel, consume ->
        val client = Wearable.getChannelClient(this)
        client.getInputStream(channel).addOnSuccessListener { input ->
            try {
                consume(input)
            } finally {
                client.close(channel)
            }
        }
        Unit
    }

    override fun onMessageReceived(event: MessageEvent) = receive(event.path, event.data)

    override fun onChannelOpened(channel: ChannelClient.Channel) {
        readChannel(channel) { input ->
            input.use { receive(channel.path, it.readBytes()) }
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        onStateItems(
            events.filter { it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == WatchPaths.STATE }
                .map {
                    val map = DataMapItem.fromDataItem(it.dataItem).dataMap
                    StateItem(map.getBoolean("enabled"), map.getLong("builtAt"))
                },
        )
    }

    internal fun onStateItems(items: Iterable<StateItem>) =
        items.forEach { receiveState(it.enabled, it.builtAt) }

    internal fun receive(path: String, data: ByteArray) {
        val incoming = WatchPaths.classify(path) ?: return
        when (incoming.kind) {
            WatchPaths.Kind.SNAPSHOT -> SnapshotStore(this).save(data)
            WatchPaths.Kind.DETAIL -> file("details", checkNotNull(incoming.key)).writeBytes(data)
            WatchPaths.Kind.IMAGE -> ImageCache(file("images")).receive(path, data)
            WatchPaths.Kind.STATE -> return
        }
        refresh(this)
    }

    internal fun receiveState(enabled: Boolean, builtAt: Long) {
        val store = SnapshotStore(this)
        val storedAt = store.latest?.get("builtAt")?.jsonPrimitive?.longOrNull
        val actions = ListenerActions.forEvent(WatchPaths.classify(WatchPaths.STATE), enabled, builtAt, storedAt)
        if (ListenerActions.Action.WIPE in actions) store.wipe()
        if (ListenerActions.Action.REFRESH_GLANCES in actions) refresh(this)
    }

    private fun file(directory: String, name: String? = null): File =
        File(filesDir, "watch/$directory").also { it.mkdirs() }.let { if (name == null) it else File(it, name) }

    internal companion object {
        var refresh: (android.content.Context) -> Unit = {
            BalanceTileService.onSnapshot(it)
            WalletComplicationService.onSnapshot(it)
        }
    }
}
