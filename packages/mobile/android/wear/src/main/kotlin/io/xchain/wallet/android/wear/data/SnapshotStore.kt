// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.data

import android.content.Context
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

class SnapshotStore private constructor(private val file: SnapshotFile) {
    constructor(context: Context) : this(File(context.filesDir, DIRECTORY_NAME))

    internal constructor(directory: File) : this(SnapshotFile(directory))

    @Volatile
    var latest: JsonObject? = file.load()?.let(::decode)
        private set

    fun age(now: Long = System.currentTimeMillis()): WatchAge.Age? =
        latest?.get("balancesAt")?.jsonPrimitive?.longOrNull?.let { WatchAge.of(it, now) }

    @Synchronized
    fun save(data: ByteArray): Boolean {
        val snapshot = decode(data) ?: return false
        val settings = runCatching { snapshot.getValue("settings").jsonObject }.getOrNull()
            ?: return false
        val enabled = settings["enabled"]?.jsonPrimitive?.booleanOrNull ?: return false
        if (!enabled) {
            latest = null
            return file.wipe()
        }
        if (snapshot["balancesAt"]?.jsonPrimitive?.longOrNull == null ||
            snapshot["session"]?.jsonPrimitive?.contentOrNull !in SESSIONS
        ) {
            return false
        }
        return runCatching { file.save(data) }
            .onSuccess { latest = snapshot }
            .isSuccess
    }

    @Synchronized
    fun wipe(): Boolean {
        latest = null
        return file.wipe()
    }

    private fun decode(data: ByteArray): JsonObject? = runCatching {
        Json.parseToJsonElement(data.decodeToString()).jsonObject
    }.getOrNull()

    internal companion object {
        const val DIRECTORY_NAME = "watch"
        private val SESSIONS = setOf("unlocked", "locked")
    }
}
