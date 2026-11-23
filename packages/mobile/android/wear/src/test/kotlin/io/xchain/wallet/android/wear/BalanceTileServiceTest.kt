// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.wear.protolayout.LayoutElementBuilders
import io.xchain.wallet.android.wear.data.GlanceSummary
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.tile.BalanceTileLayout
import io.xchain.wallet.android.wear.tile.BalanceTileService
import io.xchain.wallet.android.wear.tile.TileRefresher
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class BalanceTileServiceTest {
    @Test
    fun rendersHeadlineTopRowsAndAge() {
        val snapshot = fixture("snapshot-capped.json")
        val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)

        val layout = BalanceTileLayout.build(summary, "Updated just now", BalanceTileService.launchOpenW1("pkg"))

        val lines = (layout as LayoutElementBuilders.Column).contents.map {
            (it as LayoutElementBuilders.Text).text!!.value
        }
        assertEquals(listOf("$1,275.00") + summary.rows.map { "${it.displayName} ${it.fiatText}".trim() } + "Updated just now", lines)
        assertEquals(3, summary.rows.size)
    }

    @Test
    fun tapLaunchesTheMainActivity() {
        val layout = BalanceTileLayout.message("Waiting", BalanceTileService.launchOpenW1("pkg")) as LayoutElementBuilders.Column

        val launch = layout.modifiers!!.clickable!!.onClick as androidx.wear.protolayout.ActionBuilders.LaunchAction
        assertEquals("pkg", launch.androidActivity!!.packageName)
        assertEquals(BalanceTileService.MAIN_ACTIVITY, launch.androidActivity!!.className)
    }

    @Test
    fun refreshesAtMostOncePerFiveMinutesAndTheLastSnapshotWins() {
        var clock = 1_000L
        val scheduled = mutableListOf<Pair<Long, Runnable>>()
        val fired = mutableListOf<String>()
        val refresher = TileRefresher(now = { clock }, schedule = { d, r -> scheduled += d to r })

        refresher.onSnapshot { fired += "first" }
        clock += 10_000
        refresher.onSnapshot { fired += "second" }
        clock += 10_000
        refresher.onSnapshot { fired += "third" }

        assertEquals(listOf("first"), fired)
        assertEquals(listOf(290_000L), scheduled.map { it.first })

        clock += 290_000
        scheduled.single().second.run()
        assertEquals(listOf("first", "third"), fired)

        clock += 300_000
        refresher.onSnapshot { fired += "fourth" }
        assertEquals(listOf("first", "third", "fourth"), fired)
    }

    private fun fixture(name: String): Snapshot {
        val resource = requireNotNull(javaClass.classLoader?.getResource(name))
        return Json.decodeFromString(resource.readText())
    }
}
