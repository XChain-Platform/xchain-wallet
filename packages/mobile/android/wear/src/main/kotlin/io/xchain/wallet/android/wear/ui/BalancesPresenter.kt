// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotRow
import io.xchain.wallet.android.wear.data.WatchAge
import io.xchain.wallet.android.wear.data.WatchDisplayRules

data class BalanceText(val key: String? = null, val text: String? = null)

data class BalanceLine(
    val name: String? = null,
    val primary: BalanceText? = null,
    val secondary: BalanceText? = null,
    val key: String? = null,
)

data class BalancesDisplay(
    val header: BalanceText?,
    val lines: List<BalanceLine>,
    val banners: List<String>,
    val ageLine: String?,
    val requestKey: String?,
)

object BalancesPresenter {
    fun present(
        snapshot: Snapshot?,
        mode: WatchDisplayRules.UnitsMode? = null,
        phoneReachable: Boolean = true,
        now: Long = snapshot?.builtAt ?: 0L,
    ): BalancesDisplay {
        if (snapshot == null) return empty("state.loading")
        if (!snapshot.settings.enabled) return empty("state.watchDisabled")

        val resolved = WatchDisplayRules.resolve(mode, snapshot.unitDefault, snapshot.network.isTest)
        val fiatMode = resolved == WatchDisplayRules.UnitsMode.FIAT
        val age = WatchAge.of(snapshot.balancesAt, now)
        val banners = StateBannerRules.banners(
            true,
            snapshot.session,
            phoneReachable,
            age.bucket == WatchAge.Bucket.DAY,
        ).map { it.textKey() }
        val lines = BalancesLayout.items(snapshot.rows.size, false, snapshot.capped).map { item ->
            if (item.kind == BalancesLayout.Kind.ROW) row(snapshot.rows[item.index], fiatMode, snapshot.hidden)
            else BalanceLine(key = BalancesLayout.textKey(item))
        }
        return BalancesDisplay(
            header = when {
                snapshot.hidden && fiatMode -> BalanceText(key = "state.hidden")
                fiatMode -> BalanceText(text = snapshot.totals.fiatText)
                else -> BalanceText(key = BalancesLayout.headerKey(false))
            },
            lines = lines,
            banners = banners,
            ageLine = if (age.amber) "state.ageAmber" else "state.age",
            requestKey = "w1.requestWaiting",
        )
    }

    private fun row(row: SnapshotRow, fiatMode: Boolean, hidden: Boolean): BalanceLine {
        val primary = when {
            hidden -> BalanceText(key = "state.hidden")
            row.unavailable -> BalanceText(key = "state.balanceUnavailable")
            else -> BalanceText(text = BalanceRowRules.amountPrimary(fiatMode, row.amountText, row.fiatText))
        }
        val secondary = if (hidden || row.unavailable) null else
            BalanceRowRules.amountSecondary(fiatMode, row.amountText, row.noPrice)?.let { BalanceText(text = it) }
        return BalanceLine(name = row.displayName, primary = primary, secondary = secondary)
    }

    private fun empty(banner: String) = BalancesDisplay(null, emptyList(), listOf(banner), null, null)
}
