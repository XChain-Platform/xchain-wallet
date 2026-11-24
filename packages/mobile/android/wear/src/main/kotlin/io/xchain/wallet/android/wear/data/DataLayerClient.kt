// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.data

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import java.io.InputStream
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class DataLayerNode(val id: String, val isNearby: Boolean)

interface DataLayerSeam {
    suspend fun nodes(capability: String): List<DataLayerNode>
    suspend fun sendMessage(nodeId: String, path: String, payload: ByteArray)
}

class DataLayerClient(
    private val seam: DataLayerSeam,
    private val json: Json = Json,
) {
    constructor(context: Context) : this(PlayServicesDataLayerSeam(context))

    fun readMessage(path: String, payload: ByteArray): Any? = decode(path, payload)

    fun readChannel(path: String, input: InputStream): Any? = decode(path, input.readBytes())

    suspend fun start(appVersion: String): Boolean = sendIntent(WatchStateIntent(appVersion))

    suspend fun sendIntent(intent: Any): Boolean {
        val (kind, payload) = encode(intent)
        val node = seam.nodes(WatchPaths.PHONE_CAPABILITY).firstOrNull { it.isNearby } ?: return false
        seam.sendMessage(node.id, IntentPaths.intentPath(kind), payload)
        return true
    }

    private fun decode(path: String, payload: ByteArray): Any? = when {
        path == WatchPaths.SNAPSHOT -> json.decodeFromString<Snapshot>(payload.decodeToString())
        path.startsWith(WatchPaths.DETAIL_PREFIX) && path.length > WatchPaths.DETAIL_PREFIX.length ->
            json.decodeFromString<Detail>(payload.decodeToString())
        else -> null
    }

    private fun encode(intent: Any): Pair<String, ByteArray> {
        val encoded = when (intent) {
            is RefreshIntent -> "refresh" to json.encodeToString(intent)
            is DetailRequestIntent -> "detailRequest" to json.encodeToString(intent)
            is OpenOnPhoneIntent -> "openOnPhone" to json.encodeToString(intent)
            is MarkReadIntent -> "markRead" to json.encodeToString(intent)
            is WatchStateIntent -> "watchState" to json.encodeToString(intent)
            else -> throw IllegalArgumentException("unsupported intent")
        }
        return encoded.first to encoded.second.encodeToByteArray()
    }
}

private class PlayServicesDataLayerSeam(context: Context) : DataLayerSeam {
    private val capabilities = Wearable.getCapabilityClient(context)
    private val messages = Wearable.getMessageClient(context)

    override suspend fun nodes(capability: String): List<DataLayerNode> =
        capabilities.getCapability(capability, CapabilityClient.FILTER_REACHABLE).await().nodes
            .map { DataLayerNode(it.id, it.isNearby) }

    override suspend fun sendMessage(nodeId: String, path: String, payload: ByteArray) {
        messages.sendMessage(nodeId, path, payload).await()
    }
}
