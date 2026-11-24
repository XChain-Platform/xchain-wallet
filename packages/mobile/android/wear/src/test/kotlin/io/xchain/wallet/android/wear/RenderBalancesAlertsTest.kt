// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.render.WearRenderFrames
import io.xchain.wallet.android.wear.render.clippedTexts
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.AlertsScreen
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.BalancesScreen
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
class RenderBalancesAlertsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val json = Json
    private val balancesStrings by lazy { strings("strings-balances.json") }
    private val alertsStrings by lazy { strings("strings-alerts.json") }

    @Test
    fun rendersBalancesAtBothSizes() {
        fixtures("snapshot-").forEach { fixture ->
            val snapshot = json.decodeFromString<Snapshot>(fixture.readText())
            UnitsMode.entries.forEach { mode ->
                val display = BalancesPresenter.present(snapshot, mode, now = snapshot.builtAt)
                val amounts = display.lines.flatMap { line ->
                    listOfNotNull(line.primary?.text, line.secondary?.text)
                }
                renderCase("w1", "${fixture.nameWithoutExtension}-${mode.name.lowercase()}.json", amounts) {
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

        renderCase("w1", "snapshot-null.json") {
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
                text = ::text,
            )
        }
    }

    @Test
    fun rendersAlertsAtBothSizes() {
        val inbox = decode<List<SnapshotInboxItem>>("inbox-alerts.json")
        require(inbox.size == 20)
        renderCase("w3", "inbox-alerts.json") {
            AlertsScreen(AlertsPresenter.present(inbox, null, NOW), NOW, {}, {}, ::text)
        }
        renderCase("w3", "inbox-empty.json") {
            AlertsScreen(AlertsPresenter.present(emptyList(), null, NOW), NOW, {}, {}, ::text)
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

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}
