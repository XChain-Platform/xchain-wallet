// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performScrollToNode
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.data.SnapshotReceive
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.captureFrame
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.render.writeFrame
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.AlertsScreen
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.BalancesScreen
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RenderAllFixturesTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json
    private val balancesStrings by lazy { strings("strings-balances.json") }
    private val alertsStrings by lazy { strings("strings-alerts.json") }

    @Test
    fun rendersBalancesWithEverySnapshotAtBothSizes() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            UnitsMode.entries.forEach { mode ->
                val display = BalancesPresenter.present(snapshot, mode, now = snapshot.builtAt)
                val amounts = listOfNotNull(display.header?.text) + display.lines.flatMap { line ->
                    listOfNotNull(line.primary?.text, line.secondary?.text)
                }
                val fallbackAmount = "0.01 XCP"
                val amountTextKey = display.header?.key
                    ?: display.banners.firstOrNull()
                    ?: display.lines.firstNotNullOfOrNull { line ->
                        line.primary?.key ?: line.secondary?.key ?: line.key
                    }
                val unclippedAmounts = amounts.ifEmpty {
                    requireNotNull(amountTextKey)
                    listOf(fallbackAmount)
                }
                renderCase(
                    "w1",
                    "${fixture.nameWithoutExtension}-${mode.name.lowercase()}.json",
                    unclippedTexts = unclippedAmounts,
                ) {
                    BalancesScreen(
                        display = display,
                        mode = mode,
                        isTestNetwork = snapshot.network.isTest,
                        unread = snapshot.inbox.count { !it.read },
                        onModeChange = {},
                        onAlerts = {},
                        onReceive = {},
                        onStatus = {},
                        onRequest = null,
                        text = { key ->
                            if (amounts.isEmpty() && key == amountTextKey) fallbackAmount else text(key)
                        },
                    )
                }
            }
        }

        val nullAmount = "0.02 XCP"
        renderCase("w1", "snapshot-null.json", unclippedTexts = listOf(nullAmount)) {
            BalancesScreen(
                display = BalancesPresenter.present(null),
                mode = UnitsMode.FIAT,
                isTestNetwork = false,
                unread = 0,
                onModeChange = {},
                onAlerts = {},
                onReceive = {},
                onStatus = {},
                onRequest = null,
                text = { key -> if (key == "state.loading") nullAmount else text(key) },
            )
        }
    }

    @Test
    fun rendersTokenDetailWithEveryDetailAtBothSizes() {
        val row = decode<Snapshot>("snapshot-rows50.json").rows.first()
        fixtures("detail-").forEach { fixture ->
            val detail = json.decodeFromString<Detail>(fixture.readText())
            val display = TokenDetailPresenter.present(row, detail, phoneReachable = true)
            renderCase("w2", fixture.name, unclippedTexts = listOf(display.amountText)) {
                TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {}
            }
        }

        val display = TokenDetailPresenter.present(row, detail = null, phoneReachable = false)
        renderCase(
            "w2",
            "detail-phone-away.json",
            unclippedTexts = listOf(display.amountText),
        ) {
            TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {}
        }
    }

    @Test
    fun rendersAlertsAndEveryAlertDetailAtBothSizes() {
        val inbox = decode<List<SnapshotInboxItem>>("inbox-alerts.json")
        require(inbox.size == 20)
        val amounts = inbox.indices.map { index -> "${index + 1}.00 XCP" }
        val alerts = AlertsPresenter.present(
            inbox.mapIndexed { index, item -> item.copy(body = amounts[index]) },
            request = null,
            now = NOW,
        )
        renderCase("w3", "inbox-alerts.json", unclippedTexts = amounts) {
            AlertsScreen(alerts, NOW, {}, {}, ::text)
        }
        val emptyAmount = "0.03 XCP"
        renderCase("w3", "inbox-empty.json", unclippedTexts = listOf(emptyAmount)) {
            AlertsScreen(AlertsPresenter.present(emptyList(), null, NOW), NOW, {}, {}) { key ->
                if (key == "w3.empty") emptyAmount else text(key)
            }
        }

        alerts.rows.forEachIndexed { index, alert ->
            val fixture = "inbox-alerts-${(index + 1).toString().padStart(2, '0')}.json"
            renderCase(
                "w4",
                fixture,
                unclippedTexts = listOf(amounts[index]),
            ) {
                AlertDetailScreen(alert, null, {}, ::text) { "Nov 14, 2023" }
            }
        }
        fixtures("request-").forEach { fixture ->
            val request = json.decodeFromString<Request>(fixture.readText())
            val display = AlertsPresenter.presentRequest(request, NOW)
            renderCase("w4", fixture.name, unclippedTexts = listOf(request.amountText)) {
                AlertDetailScreen(null, display, {}, ::text) { "Jan 1, 2100" }
            }
        }
    }

    @Test
    fun rendersReceiveWithEveryReceiveStateAtBothSizes() {
        val chainAmount = "0.04 XCP"
        val receive = decode<List<SnapshotReceive>>("receive-chains.json").mapIndexed { index, item ->
            if (index == 0) item.copy(label = chainAmount) else item
        }
        renderCase("w6", "receive-chains.json", unclippedTexts = listOf(chainAmount)) {
            ReceiveScreen(receive, "Open the phone once")
        }
        val emptyAmount = "0.05 XCP"
        renderCase("w6", "receive-empty.json", unclippedTexts = listOf(emptyAmount)) {
            ReceiveScreen(emptyList(), emptyAmount)
        }
    }

    @Test
    fun rendersStatusWithEverySnapshotAtBothSizes() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            val rows = StatusRows.rows(
                true,
                snapshot.balancesAt,
                snapshot.session,
                false,
                "0.06 XCP",
            )
            renderCase("w8", fixture.name, unclippedTexts = listOf("0.06 XCP")) {
                StatusScreen(rows, {}, snapshot.builtAt, ::text)
            }
        }
    }

    @Test
    fun rendersEveryNotSetUpStateAtBothSizes() {
        val openWalletAmount = "0.07 XCP"
        renderCase("w9", "open-wallet.json", unclippedTexts = listOf(openWalletAmount)) {
            NotSetUpScreen(openWalletAmount, "Open on phone") {}
        }
        val disabledAmount = "0.08 XCP"
        renderCase("w9", "watch-disabled.json", unclippedTexts = listOf(disabledAmount)) {
            NotSetUpScreen(disabledAmount, "Open on phone") {}
        }
    }

    @Test
    fun missingExpectedAmountFailsRenderCheck() {
        val amount = "12.34 XCP"
        val renderedTexts = listOf("Balance", amount).filterNot(amount::equals)

        val failure = assertThrows(AssertionError::class.java) {
            assertRenderedAndUnclipped(
                frame = "missing-amount",
                expectedText = amount,
                renderedTexts = renderedTexts,
                clipped = emptyList(),
            )
        }

        assertTrue(failure.message.orEmpty().contains("did not render expected text: $amount"))
    }

    private fun renderCase(
        screen: String,
        fixture: String,
        unclippedTexts: List<String>,
        content: @Composable () -> Unit,
    ) {
        require(unclippedTexts.isNotEmpty()) { "$screen/$fixture expected no amount text" }
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
                val bitmap = captureFrame(controller.get())
                assertEquals("$frame width", size.pixelSide(), bitmap.width)
                assertEquals("$frame height", size.pixelSide(), bitmap.height)
                assertTrue("$frame captured fewer than two pixel colours", hasMultipleColors(bitmap))
                writeFrame(bitmap, frame)
                unclippedTexts.distinct().forEach { expectedText ->
                    require(expectedText.isNotBlank()) { "$frame expected blank text" }
                    val scrollNodes = compose.onAllNodes(hasScrollToNodeAction()).fetchSemanticsNodes()
                    if (scrollNodes.isNotEmpty()) {
                        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(expectedText))
                    }
                    compose.waitForIdle()
                    val renderedTexts = compose.onAllNodes(
                        SemanticsMatcher.keyIsDefined(SemanticsProperties.Text),
                        useUnmergedTree = true,
                    ).fetchSemanticsNodes().flatMap { node ->
                        node.config[SemanticsProperties.Text].map { it.text }
                    }
                    assertRenderedAndUnclipped(
                        frame = frame,
                        expectedText = expectedText,
                        renderedTexts = renderedTexts,
                        clipped = clippedTexts(compose),
                    )
                }
            } catch (failure: Throwable) {
                val framed = AssertionError(frame)
                framed.initCause(failure)
                throw framed
            } finally {
                controller.pause().stop().destroy()
            }
        }
    }

    private fun assertRenderedAndUnclipped(
        frame: String,
        expectedText: String,
        renderedTexts: List<String>,
        clipped: List<String>,
    ) {
        assertTrue(
            "$frame did not render expected text: $expectedText; rendered: $renderedTexts",
            renderedTexts.any { text -> text.contains(expectedText) },
        )
        assertFalse(
            "$frame clipped expected text $expectedText: $clipped",
            clipped.any { text -> text.contains(expectedText) },
        )
    }

    private fun hasMultipleColors(bitmap: Bitmap): Boolean {
        val first = bitmap.getPixel(0, 0)
        for (y in 0 until bitmap.height) {
            for (x in 0 until bitmap.width) {
                if (bitmap.getPixel(x, y) != first) return true
            }
        }
        return false
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

    private fun strings(name: String): Map<String, String> = json.decodeFromString(
        repoFile("packages/core/src/watch/contract/$name").readText(),
    )

    @Composable
    private fun text(key: String): String = balancesStrings[key]
        ?: alertsStrings[key]
        ?: error("Missing English watch string: $key")

    private fun repoFile(path: String): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        repeat(8) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile ?: return@repeat
        }
        throw AssertionError("Missing repository file: $path")
    }

    private fun noticeText(notice: TokenDetailNotice?): String? = when (notice) {
        TokenDetailNotice.MORE_DETAILS_WHEN_NEAR -> "More details when your phone is near"
        TokenDetailNotice.DETAILS_UNAVAILABLE -> "Details unavailable"
        null -> null
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}
