// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.SnapshotFile
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.data.WatchAge
import java.io.File
import java.nio.file.Files
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SnapshotStoreTest {
    private lateinit var directory: File

    @Before
    fun setUp() {
        directory = Files.createTempDirectory("snapshot-store-").toFile()
    }

    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    @Test
    fun savesLatestSnapshotAndRestoresItFromPrivateStorage() {
        val data = fixture("snapshot-empty.json")
        val store = SnapshotStore(directory)

        assertNull(store.latest)
        assertTrue(store.save(data))
        assertEquals("Daily wallet", store.latest?.get("walletName")?.jsonPrimitive?.content)
        assertTrue(directory.resolve(SnapshotFile.FILE_NAME).isFile)
        assertEquals(store.latest, SnapshotStore(directory).latest)
    }

    @Test
    fun computesAgeFromTheSnapshotBalanceTime() {
        val store = SnapshotStore(directory)
        assertTrue(store.save(fixture("snapshot-stale.json")))
        val balancesAt = store.latest!!.getValue("balancesAt").jsonPrimitive.content.toLong()

        val now = balancesAt + 16 * 60_000L
        assertEquals(WatchAge.of(balancesAt, now), store.age(now))
    }

    @Test
    fun keepsSnapshotDataWhenThePhoneIsLocked() {
        val store = SnapshotStore(directory)
        assertTrue(store.save(fixture("snapshot-empty.json")))
        assertTrue(store.save(fixture("snapshot-locked.json")))

        val latest = store.latest!!
        assertEquals("locked", latest.getValue("session").jsonPrimitive.content)
        assertEquals(1, latest.getValue("rows").jsonArray.size)
        assertEquals(latest, SnapshotStore(directory).latest)
    }

    @Test
    fun disabledSnapshotWipesMemoryAndDisk() {
        val store = SnapshotStore(directory)
        assertTrue(store.save(fixture("snapshot-empty.json")))

        assertTrue(store.save(fixture("snapshot-disabled.json")))
        assertNull(store.latest)
        assertFalse(directory.resolve(SnapshotFile.FILE_NAME).exists())
        assertNull(SnapshotStore(directory).latest)
    }

    @Test
    fun malformedSnapshotDoesNotReplaceLatest() {
        val store = SnapshotStore(directory)
        assertTrue(store.save(fixture("snapshot-empty.json")))
        val latest = store.latest

        assertFalse(store.save("{\"session\":\"locked\"}".toByteArray()))
        assertEquals(latest, store.latest)
        assertEquals(latest, SnapshotStore(directory).latest)
    }

    private fun fixture(name: String): ByteArray =
        checkNotNull(javaClass.classLoader?.getResourceAsStream(name)) { "Missing fixture $name" }
            .use { it.readBytes() }
}
