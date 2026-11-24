// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.content.res.AssetManager
import android.content.res.Resources
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performScrollToNode
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import io.xchain.wallet.android.wear.ui.BalancesScreen
import java.io.File
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w227dp-h227dp-round-watch-xhdpi")
class BalancesScreenSemanticsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun balanceLinesExposeSpokenLabels() {
        val resources = compiledResources()
        activity.setContent {
            CompositionLocalProvider(LocalResources provides resources) {
                BalancesScreen(
                    display = BalancesDisplay(
                        header = null,
                        lines = listOf(
                            BalanceLine(
                                name = "Bitcoin",
                                primary = BalanceText(text = "\$63,000.00"),
                                secondary = BalanceText(text = "1 BTC"),
                            ),
                            BalanceLine(
                                name = "Counterparty",
                                primary = BalanceText(key = "state.hidden"),
                            ),
                            BalanceLine(key = "w1.empty"),
                        ),
                        banners = emptyList(),
                        ageLine = null,
                        requestKey = null,
                    ),
                    mode = UnitsMode.FIAT,
                    isTestNetwork = false,
                    unread = 0,
                    onModeChange = {},
                    onAlerts = {},
                    onReceive = {},
                    onStatus = {},
                )
            }
        }

        val scrollable = compose.onNode(hasScrollToNodeAction())
        listOf(
            "Bitcoin, \$63,000.00, 1 BTC",
            "Counterparty, Amount hidden",
            "No balances yet",
        ).forEach { label ->
            scrollable.performScrollToNode(hasContentDescription(label))
            compose.onNode(hasContentDescription(label)).assertIsDisplayed()
        }
    }

    private fun compiledResources(): Resources {
        val resourcePackage = repoFile(
            "packages/mobile/android/wear/build/intermediates/linked_resources_binary_format/" +
                "debug/processDebugResources/linked-resources-binary-format-debug.ap_",
        )
        val assets = AssetManager::class.java.getDeclaredConstructor().newInstance()
        assets.javaClass.getMethod("addAssetPath", String::class.java).invoke(assets, resourcePackage.path)
        return Resources(assets, activity.resources.displayMetrics, activity.resources.configuration)
    }

    private fun repoFile(path: String): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        repeat(8) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile ?: return@repeat
        }
        throw AssertionError("Missing repository file: $path")
    }
}
