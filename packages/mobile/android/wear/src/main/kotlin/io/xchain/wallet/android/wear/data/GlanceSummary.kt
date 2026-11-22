// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.data

data class GlanceSummary(
    val headline: String,
    val rows: List<SnapshotRow>,
    val age: WatchAge.Age,
) {
    companion object {
        fun from(snapshot: Snapshot, now: Long): GlanceSummary {
            val unreadCount = GlanceRules.unreadCount(snapshot.inbox.count { !it.read })
            val headline = if (
                GlanceRules.showsTotal(
                    snapshot.settings.showTotal,
                    snapshot.session,
                    snapshot.hidden,
                    snapshot.totals.fiatText,
                )
            ) {
                snapshot.totals.fiatText
            } else {
                unreadCount.toString()
            }
            val rows = if (GlanceRules.showsRows(snapshot.session, snapshot.hidden)) {
                GlanceRules.topRows(snapshot.rows)
            } else {
                emptyList()
            }

            return GlanceSummary(headline, rows, WatchAge.of(snapshot.balancesAt, now))
        }
    }
}
