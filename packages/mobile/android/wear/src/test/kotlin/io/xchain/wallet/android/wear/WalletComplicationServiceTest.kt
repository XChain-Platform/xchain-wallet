// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.app.PendingIntent
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import io.xchain.wallet.android.wear.complication.WalletComplicationService
import io.xchain.wallet.android.wear.data.GlanceSummary
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchAge
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WalletComplicationServiceTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun shortTextShowsGlanceHeadlineAndOpensTheApp() {
        val snapshot = fixture("snapshot-capped.json")
        val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)
        val tap = PendingIntent.getActivity(
            context,
            0,
            Intent(),
            PendingIntent.FLAG_IMMUTABLE,
        )

        val data = WalletComplicationService.dataFor(ComplicationType.SHORT_TEXT, summary, tap)

        assertTrue(data is ShortTextComplicationData)
        data as ShortTextComplicationData
        assertEquals("$1,275.00", data.text.getTextAt(context.resources, java.time.Instant.EPOCH).toString())
        assertSame(tap, data.tapAction)
    }

    @Test
    fun lockedSnapshotShowsOnlyTheUnreadCount() {
        val snapshot = fixture("snapshot-locked.json")
        val summary = GlanceSummary.from(snapshot, snapshot.balancesAt)

        val data = WalletComplicationService.dataFor(ComplicationType.SHORT_TEXT, summary, null)

        data as ShortTextComplicationData
        assertEquals("0", data.text.getTextAt(context.resources, java.time.Instant.EPOCH).toString())
    }

    @Test
    fun missingSnapshotYieldsNoData() {
        val data = WalletComplicationService.dataFor(ComplicationType.SHORT_TEXT, null, null)

        assertTrue(data is NoDataComplicationData)
    }

    @Test
    fun otherTypesAreUnsupported() {
        assertNull(WalletComplicationService.dataFor(ComplicationType.LONG_TEXT, null, null))
    }

    @Test
    fun previewIsShortTextOnly() {
        val service = WalletComplicationService()

        assertTrue(service.getPreviewData(ComplicationType.SHORT_TEXT) is ShortTextComplicationData)
        assertNull(service.getPreviewData(ComplicationType.RANGED_VALUE))
    }

    private fun fixture(name: String): Snapshot {
        val resource = requireNotNull(javaClass.classLoader?.getResource(name))
        return Json.decodeFromString(resource.readText())
    }
}
