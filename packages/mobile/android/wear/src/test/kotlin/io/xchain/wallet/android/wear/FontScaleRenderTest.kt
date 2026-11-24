// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.text.TextLayoutResult
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.WithFontScale
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.BalancesScreen
import io.xchain.wallet.android.wear.ui.TokenDetailNotice
import io.xchain.wallet.android.wear.ui.TokenDetailPresenter
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import java.io.File
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
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
class FontScaleRenderTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json
    private val balancesStrings by lazy { strings("strings-balances.json") }
    private val alertsStrings by lazy { strings("strings-alerts.json") }

    @Test
    fun rendersBalancesAtLargeFontScale() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            UnitsMode.entries.forEach { mode ->
                val display = BalancesPresenter.present(snapshot, mode, now = snapshot.builtAt)
                val amounts = display.lines.flatMap { line ->
                    listOfNotNull(line.primary?.text, line.secondary?.text)
                }
                renderCase(
                    "w1",
                    "${fixture.nameWithoutExtension}-${mode.name.lowercase()}.json",
                    amounts,
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
                        text = ::text,
                    )
                }
            }
        }
    }

    @Test
    fun rendersTokenDetailsAtLargeFontScale() {
        val detailFixtures = listOf(
            "detail-cached.json",
            "detail-native.json",
            "detail-noart.json",
            "detail-loaderror.json",
        )
        listOf("snapshot-rows50.json", "snapshot-longnames.json").forEach { snapshotFixture ->
            val row = decode<Snapshot>(snapshotFixture).rows.first()
            detailFixtures.forEach { detailFixture ->
                val display = TokenDetailPresenter.present(
                    row,
                    decode<Detail>(detailFixture),
                    phoneReachable = true,
                )
                val fixture = "${snapshotFixture.removeSuffix(".json")}-${detailFixture}"
                renderCase("w2", fixture, listOf(row.amountText, row.fiatText)) {
                    TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {}
                }
            }
        }
    }

    private fun renderCase(
        screen: String,
        fixture: String,
        amounts: List<String>,
        content: @Composable () -> Unit,
    ) {
        WearRenderFrames.Size.entries.forEach { size ->
            val frame = WearRenderFrames.frameName(screen, fixture, size)
            RuntimeEnvironment.setQualifiers(size.qualifiers())
            val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
            try {
                controller.get().setContent {
                    WithFontScale(1.3f) {
                        content()
                    }
                }
                compose.waitForIdle()
                val nodes = compose.onAllNodes(
                    SemanticsMatcher("any node") { true },
                    useUnmergedTree = true,
                ).fetchSemanticsNodes()
                assertTrue("$frame at fontScale $FONT_SCALE rendered no semantics nodes", nodes.isNotEmpty())
                val clipped = clippedTexts(compose)
                assertFalse(
                    "$frame at fontScale $FONT_SCALE clipped an amount: $clipped",
                    clipped.any { text -> amounts.any(text::contains) },
                )
                assertAmountFontScale(frame, amounts)
            } catch (failure: Throwable) {
                val framed = AssertionError("$frame at fontScale $FONT_SCALE")
                framed.initCause(failure)
                throw framed
            } finally {
                controller.pause().stop().destroy()
            }
        }
    }

    private fun assertAmountFontScale(frame: String, amounts: List<String>) {
        compose.onAllNodes(
            SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult),
            useUnmergedTree = true,
        ).fetchSemanticsNodes().forEach { node ->
            val text = node.config[SemanticsProperties.Text].joinToString("") { it.text }
            if (amounts.none(text::contains)) return@forEach
            val results = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
            assertTrue(
                "$frame at fontScale $FONT_SCALE had no layout result for amount $text",
                results.isNotEmpty(),
            )
            results.forEach { result ->
                assertEquals(
                    "$frame amount $text did not use fontScale $FONT_SCALE",
                    FONT_SCALE,
                    result.layoutInput.density.fontScale,
                    0f,
                )
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
        const val FONT_SCALE = 1.3f
    }
}
