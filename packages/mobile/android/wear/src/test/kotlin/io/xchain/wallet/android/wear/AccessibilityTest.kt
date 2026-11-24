// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.text.TextLayoutResult
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.DetailFact
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.WithFontScale
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.ui.AccessibilityLabels
import io.xchain.wallet.android.wear.ui.AlertDetailLine
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertDisplay
import io.xchain.wallet.android.wear.ui.AlertDisplayValue
import io.xchain.wallet.android.wear.ui.AlertsDisplay
import io.xchain.wallet.android.wear.ui.AlertsScreen
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.BalancesScreen
import io.xchain.wallet.android.wear.ui.RequestDisplay
import io.xchain.wallet.android.wear.ui.TokenDetailDisplay
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

@RunWith(AccessibilityTestRunner::class)
@Config(sdk = [35])
class AccessibilityTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json
    private val balancesStrings by lazy { strings("strings-balances.json") }
    private val alertsStrings by lazy { strings("strings-alerts.json") }

    @Test
    fun everyW1ToW4LabelUsesSharedAccessibilityText() {
        val balanceDisplay = BalancesDisplay(
            header = null,
            lines = listOf(
                BalanceLine(
                    name = "Bitcoin",
                    primary = BalanceText(text = "\$63,000.00"),
                    secondary = BalanceText(text = "1 BTC"),
                ),
                BalanceLine(name = "Counterparty", primary = BalanceText(key = "state.hidden")),
                BalanceLine(key = "w1.empty"),
            ),
            banners = emptyList(),
            ageLine = null,
            requestKey = "w1.requestWaiting",
        )
        show(
            content = {
                BalancesScreen(
                    balanceDisplay,
                    UnitsMode.FIAT,
                    false,
                    0,
                    {},
                    {},
                    {},
                    {},
                    {},
                    ::text,
                )
            },
            verify = {
                (AccessibilityLabels.balanceLines(balanceDisplay, ::plainText) +
                    AccessibilityLabels.requestPinned("w1.requestWaiting", ::plainText)).forEach {
                    assertLabel(it)
                }
            },
        )

        val tokenDisplay = tokenDisplay()
        show(
            content = {
                TokenDetailScreen(tokenDisplay, null, "Open on phone", null, "Amount hidden") {}
            },
            verify = {
                val identity = AccessibilityLabels.tokenIdentity(tokenDisplay)
                compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasContentDescription(identity))
                compose.onAllNodes(hasContentDescription(identity)).assertCountEquals(2)
                assertLabel(AccessibilityLabels.tokenAmount(tokenDisplay, false, "Amount hidden"), click = true)
                assertLabel(AccessibilityLabels.tokenAmount(tokenDisplay, true, "Amount hidden"))
                tokenDisplay.facts.map(AccessibilityLabels::fact).forEach { assertLabel(it) }
            },
        )

        val alert = AlertDisplay(
            "alert-1",
            "paydue",
            "Payment due",
            "Complete your payment",
            NOW - 2 * HOUR,
            true,
        )
        show(
            content = { AlertsScreen(AlertsDisplay(listOf(alert), null, null), NOW, {}, {}, ::text) },
            verify = { assertLabel(AccessibilityLabels.alertRow(alert, "2 h ago")) },
        )

        val request = RequestDisplay(
            AlertDisplayValue(key = "w1.requestWaiting"),
            listOf(
                AlertDetailLine(
                    AlertDisplayValue(key = "w4.requestSentence"),
                    AlertDisplayValue(text = "Confirm this Send request on your phone."),
                ),
                AlertDetailLine(
                    AlertDisplayValue(key = "w4.requestAmount"),
                    AlertDisplayValue(text = "0.025 BTC"),
                ),
                AlertDetailLine(
                    AlertDisplayValue(key = "w4.requestExpiry"),
                    AlertDisplayValue(at = 4_102_444_800_000L),
                ),
            ),
        )
        show(
            content = { AlertDetailScreen(null, request, {}, ::text) { "at:$it" } },
            verify = {
                AccessibilityLabels.requestLines(request, ::plainText) { "at:$it" }.forEach {
                    assertLabel(it)
                }
            },
        )
    }

    @Test
    fun w1AndW2RenderAtLargeFontScaleOnBothRoundSizes() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            UnitsMode.entries.forEach { mode ->
                val display = BalancesPresenter.present(snapshot, mode, now = snapshot.builtAt)
                val amounts = display.lines.flatMap { line ->
                    listOfNotNull(line.primary?.text, line.secondary?.text)
                }
                renderCase("w1", "${fixture.nameWithoutExtension}-${mode.name.lowercase()}.json", amounts) {
                    BalancesScreen(
                        display,
                        mode,
                        snapshot.network.isTest,
                        snapshot.inbox.count { !it.read },
                        {},
                        {},
                        {},
                        {},
                        null,
                        ::text,
                    )
                }
            }
        }

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
                renderCase(
                    "w2",
                    fixture,
                    listOf(row.amountText, row.fiatText),
                    prepareAmount = { amount ->
                        if (amount == row.fiatText) {
                            scrollToAmount(row.amountText)
                            val node = compose.onNodeWithText(row.amountText).fetchSemanticsNode()
                            checkNotNull(node.config[SemanticsActions.OnClick].action).invoke()
                        }
                        scrollToAmount(amount)
                    },
                ) { TokenDetailScreen(display, null, "Open on phone", noticeText(display.notice)) {} }
            }
        }
    }

    private fun show(content: @Composable () -> Unit, verify: () -> Unit) {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        try {
            controller.get().setContent(content = content)
            compose.waitForIdle()
            verify()
        } finally {
            controller.pause().stop().destroy()
        }
    }

    private fun assertLabel(label: String, click: Boolean = false) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasContentDescription(label))
        compose.onNode(hasContentDescription(label)).assertIsDisplayed().also {
            if (click) it.performClick()
        }
    }

    private fun renderCase(
        screen: String,
        fixture: String,
        amounts: List<String>,
        prepareAmount: (String) -> Unit = ::scrollToAmount,
        content: @Composable () -> Unit,
    ) {
        WearRenderFrames.Size.entries.forEach { size ->
            val frame = WearRenderFrames.frameName(screen, fixture, size)
            RuntimeEnvironment.setQualifiers(size.qualifiers())
            val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
            try {
                controller.get().setContent {
                    WithFontScale(FONT_SCALE, content)
                }
                compose.waitForIdle()
                val nodes = compose.onAllNodes(
                    SemanticsMatcher("any node") { true },
                    useUnmergedTree = true,
                ).fetchSemanticsNodes()
                assertTrue("$frame rendered no semantics nodes", nodes.isNotEmpty())
                assertAmountFontScale(frame, amounts, prepareAmount)
            } catch (failure: Throwable) {
                throw AssertionError("$frame at fontScale $FONT_SCALE", failure)
            } finally {
                controller.pause().stop().destroy()
            }
        }
    }

    private fun assertAmountFontScale(
        frame: String,
        amounts: List<String>,
        prepareAmount: (String) -> Unit,
    ) {
        amounts.forEach { amount ->
            prepareAmount(amount)
            compose.waitForIdle()
            val clipped = clippedTexts(compose)
            assertFalse(
                "$frame clipped an amount while showing $amount: $clipped",
                clipped.any { text -> amounts.any(text::contains) },
            )
            val matches = compose.onAllNodes(
                SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult),
                useUnmergedTree = true,
            ).fetchSemanticsNodes().mapNotNull { node ->
                val text = node.config[SemanticsProperties.Text].joinToString("") { it.text }
                node.takeIf { text.contains(amount) }?.let { it to text }
            }
            assertTrue("$frame had no text-layout node for amount $amount", matches.isNotEmpty())
            matches.forEach { (node, text) ->
                val results = mutableListOf<TextLayoutResult>()
                node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
                assertTrue("$frame had no layout result for amount $amount in $text", results.isNotEmpty())
                results.forEach { result ->
                    assertEquals(FONT_SCALE, result.layoutInput.density.fontScale, 0f)
                }
            }
        }
    }

    private fun scrollToAmount(amount: String) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(amount))
    }

    private fun tokenDisplay() = TokenDetailDisplay(
        tokenId = "bitcoin-mainnet:XC",
        displayName = "XChain",
        tick = "XC",
        amountText = "42 XC",
        valueText = "\$1,234.56",
        artworkHash = null,
        glyph = "X",
        glyphRgb = listOf(26 / 255.0, 116 / 255.0, 168 / 255.0),
        changeText = null,
        priceSourceText = null,
        chart = null,
        facts = listOf(DetailFact("Supply", "21,000,000")),
        description = null,
        notice = null,
    )

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
        ROOT.resolve("packages/core/src/watch/contract/$name").readText(),
    )

    @Composable
    private fun text(key: String): String = plainText(key)

    private fun plainText(key: String): String = balancesStrings[key]
        ?: alertsStrings[key]
        ?: error("Missing English watch string: $key")

    private fun noticeText(notice: TokenDetailNotice?): String? = when (notice) {
        TokenDetailNotice.MORE_DETAILS_WHEN_NEAR -> "More details when your phone is near"
        TokenDetailNotice.DETAILS_UNAVAILABLE -> "Details unavailable"
        null -> null
    }

    private companion object {
        const val FONT_SCALE = 1.3f
        const val NOW = 1_700_000_000_000L
        const val HOUR = 3_600_000L
        val ROOT = generateSequence(File(requireNotNull(System.getProperty("user.dir"))).canonicalFile) {
            it.parentFile
        }.first { it.resolve("packages/mobile/android").isDirectory }
    }
}

class AccessibilityTestRunner(testClass: Class<*>) : RobolectricTestRunner(testClass) {
    private companion object {
        init {
            val root = generateSequence(File(requireNotNull(System.getProperty("user.dir"))).canonicalFile) {
                it.parentFile
            }.first { it.resolve("packages/mobile/android").isDirectory }
            System.setProperty(
                "maven.repo.local",
                root.resolve("tmp/watch-test/m2").also { it.mkdirs() }.path,
            )
        }
    }
}
