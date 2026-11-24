// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.complication

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import io.xchain.wallet.android.wear.data.GlanceSummary
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.tile.TileRefresher
import kotlinx.serialization.json.Json

class WalletComplicationService : ComplicationDataSourceService() {
    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val summary = runCatching {
            SnapshotStore(applicationContext).latest?.let {
                GlanceSummary.from(
                    Json.decodeFromJsonElement(Snapshot.serializer(), it),
                    System.currentTimeMillis(),
                )
            }
        }.getOrNull()
        listener.onComplicationData(dataFor(request.complicationType, summary, openWallet()))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        dataFor(type, null, null, PREVIEW_TEXT)

    private fun openWallet(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        packageManager.getLaunchIntentForPackage(packageName) ?: Intent(),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    internal companion object {
        const val PREVIEW_TEXT = "$0.00"
        internal var refresher: TileRefresher = TileRefresher(
            now = System::currentTimeMillis,
            schedule = { delayMs, task -> Handler(Looper.getMainLooper()).postDelayed(task, delayMs) },
        )
        internal var requestAll: (Context) -> Unit = { context ->
            ComplicationDataSourceUpdateRequester.create(
                context,
                ComponentName(context, WalletComplicationService::class.java),
            ).requestUpdateAll()
        }

        fun onSnapshot(context: Context) {
            refresher.onSnapshot { requestAll(context) }
        }

        fun dataFor(
            type: ComplicationType,
            summary: GlanceSummary?,
            tap: PendingIntent?,
            previewText: String? = null,
        ): ComplicationData? {
            if (type != ComplicationType.SHORT_TEXT) return null
            val text = previewText ?: summary?.headline ?: return NoDataComplicationData()
            return ShortTextComplicationData.Builder(
                PlainComplicationText.Builder(text).build(),
                PlainComplicationText.Builder("XChain $text").build(),
            ).setTapAction(tap).build()
        }
    }
}
