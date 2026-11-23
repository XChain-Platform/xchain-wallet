// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

@Serializable
data class Snapshot(
    val v: Int,
    @Serializable(with = StrictLongSerializer::class)
    val builtAt: Long,
    @Serializable(with = StrictLongSerializer::class)
    val balancesAt: Long,
    @Serializable(with = StrictLongSerializer::class)
    val pricesAt: Long,
    val session: String,
    val network: SnapshotNetwork,
    val fiatCode: String,
    val hidden: Boolean,
    val unitDefault: String,
    val walletName: String,
    val totals: SnapshotTotals,
    val rows: List<SnapshotRow>,
    val capped: Boolean,
    val receive: List<SnapshotReceive>,
    val inbox: List<SnapshotInboxItem>,
    val request: Request,
    val settings: SnapshotSettings,
)

@Serializable
data class SnapshotNetwork(
    val kind: String,
    val isTest: Boolean,
)

@Serializable
data class SnapshotTotals(
    val fiatText: String,
    val unitsText: String,
)

@Serializable
data class SnapshotRow(
    val id: String,
    val chainId: String,
    val tick: String,
    val displayName: String,
    val amountText: String,
    val fiatText: String,
    val noPrice: Boolean,
    val pendingText: String,
    val unavailable: Boolean,
    val iconHash: String,
    val tickerColor: String,
    val hasDetail: Boolean,
)

@Serializable
data class SnapshotReceive(
    val chainId: String,
    val label: String,
    val address: String,
    val qr: SnapshotQr,
)

@Serializable
data class SnapshotQr(
    val size: Int,
    val bits: String,
)

@Serializable
data class SnapshotInboxItem(
    val id: String,
    val family: String,
    val kind: String,
    val title: String,
    val body: String,
    @Serializable(with = StrictLongSerializer::class)
    val at: Long,
    val read: Boolean,
)

@Serializable
data class SnapshotSettings(
    val showTotal: Boolean,
    val enabled: Boolean,
)

private object StrictLongSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("StrictLong", PrimitiveKind.LONG)

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }

    override fun deserialize(decoder: Decoder): Long {
        if (decoder !is JsonDecoder) return decoder.decodeLong()

        val value = decoder.decodeJsonElement()
        if (value !is JsonPrimitive || value.isString) {
            throw SerializationException("Expected an integer")
        }
        return value.longOrNull
            ?: throw SerializationException("Expected a 64-bit integer")
    }
}
