// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.data.SnapshotReceive
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.NotSetUpScreen
import io.xchain.wallet.android.wear.ui.ReceiveScreen
import io.xchain.wallet.android.wear.ui.StatusRows
import io.xchain.wallet.android.wear.ui.StatusScreen
import io.xchain.wallet.android.wear.ui.TokenDetailNotice
import io.xchain.wallet.android.wear.ui.TokenDetailPresenter
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RenderLandedScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json

    @Test
    fun rendersTokenDetailsAtBothSizes() {
        val row = decode<Snapshot>("snapshot-rows50.json").rows.first()
        val detailFixtures = listOf(
            "detail-cached.json",
            "detail-native.json",
            "detail-noart.json",
            "detail-loaderror.json",
        )

        detailFixtures.forEach { fixture ->
            val display = TokenDetailPresenter.present(row, decode<Detail>(fixture), phoneReachable = true)
            renderCase("w2", fixture, amounts = listOf(row.amountText, row.fiatText)) {
                TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {}
            }
        }

        val display = TokenDetailPresenter.present(row, detail = null, phoneReachable = false)
        renderCase("w2", "detail-phone-away.json", amounts = listOf(row.amountText, row.fiatText)) {
            TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {}
        }
    }

    @Test
    fun rendersAlertsAndRequestsAtBothSizes() {
        val inbox = decode<List<SnapshotInboxItem>>("inbox-alerts.json")
        val alerts = AlertsPresenter.present(inbox, request = null, now = NOW).rows
        require(alerts.size == 20)
        alerts.forEachIndexed { index, alert ->
            val fixture = "inbox-alerts-${(index + 1).toString().padStart(2, '0')}.json"
            renderCase("w4", fixture) {
                AlertDetailScreen(alert, null, {}, ::alertText) { "Nov 14, 2023" }
            }
        }

        fixtures("request-").forEach { fixture ->
            val request = json.decodeFromString<Request>(fixture.readText())
            val display = AlertsPresenter.presentRequest(request, NOW)
            renderCase("w4", fixture.name, amounts = listOf(request.amountText)) {
                AlertDetailScreen(null, display, {}, ::alertText) { "Jan 1, 2100" }
            }
        }
    }

    @Test
    fun rendersReceiveAtBothSizes() {
        val receive = decode<List<SnapshotReceive>>("receive-chains.json")
        renderCase("w6", "receive-chains.json") {
            ReceiveScreen(receive, "Open XChain Wallet on your phone once")
        }
        renderCase("w6", "receive-empty.json") {
            ReceiveScreen(emptyList(), "Open XChain Wallet on your phone once")
        }
    }

    @Test
    fun rendersStatusAtBothSizes() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            val rows = StatusRows.rows(
                true,
                snapshot.balancesAt,
                snapshot.session,
                false,
                "1.0.0",
            )
            renderCase("w8", fixture.name) {
                StatusScreen(rows, {}, snapshot.builtAt, ::statusText)
            }
        }
    }

    @Test
    fun rendersNotSetUpAtBothSizes() {
        renderCase("w9", "open-wallet.json") {
            NotSetUpScreen("Open XChain Wallet on your phone", "Open on phone") {}
        }
        renderCase("w9", "watch-disabled.json") {
            NotSetUpScreen("Show wallet on watch is off on your phone", "Open on phone") {}
        }
    }

    private fun renderCase(
        screen: String,
        fixture: String,
        amounts: List<String> = emptyList(),
        content: @Composable () -> Unit,
    ) {
        WearRenderFrames.Size.entries.forEach { size ->
            val frame = WearRenderFrames.frameName(screen, fixture, size)
            RuntimeEnvironment.setQualifiers(size.qualifiers())
            val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
            try {
                controller.get().setContent(content = content)
                compose.waitForIdle()
                val nodes = compose.onAllNodes(
                    SemanticsMatcher("any node") { true },
                    useUnmergedTree = true,
                ).fetchSemanticsNodes()
                assertTrue("$frame rendered no semantics nodes", nodes.isNotEmpty())
                val clipped = clippedTexts(compose)
                assertFalse(
                    "$frame clipped an amount: $clipped",
                    clipped.any { text -> amounts.any(text::contains) },
                )
            } catch (failure: Throwable) {
                val framed = AssertionError(frame)
                framed.initCause(failure)
                throw framed
            } finally {
                controller.pause().stop().destroy()
            }
        }
    }

    private inline fun <reified T> decode(name: String): T =
        json.decodeFromString(resource(name).readText())

    private fun fixtures(prefix: String): List<File> {
        val directory = requireNotNull(resource("snapshot-empty.json").parentFile)
        return requireNotNull(directory.listFiles())
            .filter { it.isFile && it.name.startsWith(prefix) && it.extension == "json" }
            .sortedBy { it.name }
            .also { require(it.isNotEmpty()) }
    }

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)

    @Composable
    private fun alertText(key: String): String = mapOf(
        "w4.title" to "Alert detail",
        "w4.openOnPhone" to "Open on phone",
        "w4.requestSentence" to "Request",
        "w4.requestAmount" to "Amount",
        "w4.requestExpired" to "This request expired.",
        "w4.requestExpiry" to "Expires",
    ).getValue(key)

    @Composable
    private fun statusText(key: String): String = mapOf(
        "state.status" to "Status",
        "state.phoneReachable" to "Phone reachable",
        "state.lastSync" to "Last sync",
        "state.session" to "Session",
        "state.hideAmounts" to "Hide amounts",
        "state.version" to "Version",
        "state.sessionUnknown" to "Session unknown",
        "state.locked" to "Wallet locked on phone",
        "state.unreachable" to "Phone not in range",
        "state.ageJustNow" to "Updated just now",
        "state.ageMinutes" to "Updated {n} min ago",
        "state.ageHours" to "Updated {n} h ago",
        "state.stale24h" to "Open XChain Wallet on your phone to refresh",
    ).getValue(key)

    private fun noticeText(notice: TokenDetailNotice?): String? = when (notice) {
        TokenDetailNotice.MORE_DETAILS_WHEN_NEAR -> "More details when your phone is near"
        TokenDetailNotice.DETAILS_UNAVAILABLE -> "Details unavailable"
        null -> null
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}
