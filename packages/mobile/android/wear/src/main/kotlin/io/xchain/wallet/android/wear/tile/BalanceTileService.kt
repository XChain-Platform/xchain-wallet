// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.tile

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.GlanceRefreshGate
import io.xchain.wallet.android.wear.data.GlanceRules
import io.xchain.wallet.android.wear.data.GlanceSummary
import io.xchain.wallet.android.wear.data.RelativeTimeKeys
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.data.WatchAge
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json

class BalanceTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val summary = SnapshotStore(this).latest
            ?.let { runCatching { json.decodeFromJsonElement(Snapshot.serializer(), it) }.getOrNull() }
            ?.let { GlanceSummary.from(it, System.currentTimeMillis()) }
        val content = summary
            ?.let { BalanceTileLayout.build(it, ageText(it.age), launchOpenW1(packageName)) }
            ?: BalanceTileLayout.message(getString(R.string.state_loading), launchOpenW1(packageName))
        return completedFuture(
            TileBuilders.Tile.Builder()
                .setResourcesVersion(RESOURCES_VERSION)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(content))
                .build(),
        )
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> =
        completedFuture(ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build())

    private fun <T> completedFuture(value: T): ListenableFuture<T> = object : ListenableFuture<T> {
        override fun addListener(listener: Runnable, executor: Executor) = executor.execute(listener)
        override fun cancel(mayInterruptIfRunning: Boolean) = false
        override fun isCancelled() = false
        override fun isDone() = true
        override fun get(): T = value
        override fun get(timeout: Long, unit: TimeUnit): T = value
    }

    private fun ageText(age: WatchAge.Age): String = when (age.bucket) {
        WatchAge.Bucket.JUST_NOW -> getString(R.string.state_age_just_now)
        WatchAge.Bucket.MINUTES -> RelativeTimeKeys.fill(getString(R.string.state_age_minutes), age.n.toInt())
        WatchAge.Bucket.HOURS -> RelativeTimeKeys.fill(getString(R.string.state_age_hours), age.n.toInt())
        WatchAge.Bucket.DAY -> getString(R.string.state_stale24h)
    }

    companion object {
        internal const val MAIN_ACTIVITY = "io.xchain.wallet.android.wear.MainActivity"
        private const val RESOURCES_VERSION = "1"
        private val json = Json { ignoreUnknownKeys = true }
        private val refresher = TileRefresher(
            now = System::currentTimeMillis,
            schedule = { delayMs, task -> Handler(Looper.getMainLooper()).postDelayed(task, delayMs) },
        )

        fun onSnapshot(context: Context) {
            val updater = getUpdater(context)
            refresher.onSnapshot { updater.requestUpdate(BalanceTileService::class.java) }
        }

        internal fun launchOpenW1(packageName: String): ModifiersBuilders.Clickable =
            ModifiersBuilders.Clickable.Builder()
                .setId("open_w1")
                .setOnClick(
                    ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(
                            ActionBuilders.AndroidActivity.Builder()
                                .setPackageName(packageName)
                                .setClassName(MAIN_ACTIVITY)
                                .build(),
                        )
                        .build(),
                )
                .build()
    }
}

internal object BalanceTileLayout {
    fun build(summary: GlanceSummary, ageText: String, open: ModifiersBuilders.Clickable) =
        column(open).apply {
            addContent(text(summary.headline))
            summary.rows.forEach { addContent(text("${it.displayName} ${it.fiatText}".trim())) }
            addContent(text(ageText))
        }.build()

    fun message(text: String, open: ModifiersBuilders.Clickable) = column(open).addContent(text(text)).build()

    private fun column(open: ModifiersBuilders.Clickable) = LayoutElementBuilders.Column.Builder()
        .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).build())

    private fun text(value: String) = LayoutElementBuilders.Text.Builder().setText(value).build()
}

internal class TileRefresher(
    private val gate: GlanceRefreshGate = GlanceRefreshGate(),
    private val now: () -> Long,
    private val schedule: (Long, Runnable) -> Unit,
) {
    private var pending: (() -> Unit)? = null

    fun onSnapshot(update: () -> Unit) {
        val at = now()
        val decision = gate.onSnapshot(at, GlanceRules.refreshDelayMs(gate.lastRefreshAtMs(), at))
        when (decision.action()) {
            GlanceRefreshGate.Action.REFRESH_NOW -> {
                pending = null
                update()
            }
            GlanceRefreshGate.Action.SCHEDULE -> {
                pending = update
                schedule(decision.delayMs()) {
                    val latest = pending
                    if (gate.onScheduledFire(now()) && latest != null) {
                        pending = null
                        latest()
                    }
                }
            }
            GlanceRefreshGate.Action.COALESCED -> pending = update
        }
    }
}
