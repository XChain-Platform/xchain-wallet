// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.GlanceSummary
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.data.WatchAge
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GlanceSummaryTest {
    @Test
    fun usesVisibleTotalAndFirstThreeRows() {
        val snapshot = fixture("snapshot-capped.json")

        val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)

        assertEquals("$1,275.00", summary.headline)
        assertEquals(listOf("Token 01", "Token 02", "Token 03"), summary.rows.map { it.displayName })
        assertEquals(WatchAge.Age(WatchAge.Bucket.JUST_NOW, 0, false), summary.age)
    }

    @Test
    fun usesUnreadCountWhenShowTotalIsOff() {
        val snapshot = fixture("snapshot-disabled.json").copy(
            inbox = listOf(inbox(read = false), inbox(read = true), inbox(read = false)),
        )

        val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)

        assertEquals("2", summary.headline)
        assertTrue(summary.rows.isEmpty())
    }

    @Test
    fun lockedAndHiddenSnapshotsExposeOnlyUnreadCount() {
        listOf("snapshot-locked.json", "snapshot-hidden.json").forEach { name ->
            val snapshot = fixture(name).copy(inbox = listOf(inbox(read = false)))

            val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)

            assertEquals(name, "1", summary.headline)
            assertTrue(name, summary.rows.isEmpty())
        }
    }

    @Test
    fun computesAgeFromFixtureBalanceTime() {
        val snapshot = fixture("snapshot-stale.json")

        val summary = GlanceSummary.from(snapshot, NOW)

        assertEquals(WatchAge.Age(WatchAge.Bucket.MINUTES, 16, true), summary.age)
    }

    private fun fixture(name: String): Snapshot {
        val resource = requireNotNull(javaClass.classLoader?.getResource(name))
        return Json.decodeFromString(resource.readText())
    }

    private fun inbox(read: Boolean) = SnapshotInboxItem(
        id = "alert-$read",
        family = "messages",
        kind = "message",
        title = "New message",
        body = "Open on phone",
        at = NOW,
        read = read,
    )

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}
