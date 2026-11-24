// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchNavTest {
    @Test
    fun hostsEveryDesignScreenInTheSwipeGraph() {
        val source = repoFile(
            "packages/mobile/android/wear/src/main/kotlin/" +
                "io/xchain/wallet/android/wear/nav/WatchNav.kt",
        ).readText()

        assertTrue(source.contains("SwipeDismissableNavHost("))
        listOf("BALANCES", "ALERTS", "RECEIVE", "STATUS", "NOT_SET_UP").forEach {
            assertTrue("missing $it", source.contains("composable(Screen.$it.route())"))
        }
        listOf("TOKEN_DETAIL", "ALERT_DETAIL").forEach {
            assertTrue(
                "missing $it",
                source.contains("composable(WatchNavRoutes.pattern(Screen.$it))"),
            )
        }
    }

    @Test
    fun wiresEveryPushAndTheLauncherActivity() {
        val nav = repoFile(
            "packages/mobile/android/wear/src/main/kotlin/" +
                "io/xchain/wallet/android/wear/nav/WatchNav.kt",
        ).readText()
        val activity = repoFile(
            "packages/mobile/android/wear/src/main/kotlin/" +
                "io/xchain/wallet/android/wear/MainActivity.kt",
        ).readText()

        listOf("ALERTS", "RECEIVE", "STATUS").forEach {
            assertTrue("missing $it push", nav.contains("nav.navigate(Screen.$it.route())"))
        }
        assertTrue(nav.contains("nav.navigate(WatchNavRoutes.alertDetail(id))"))
        assertTrue(nav.contains("WatchScreenGraph.root("))
        assertTrue(nav.contains("client.start(appVersion)"))
        assertTrue(nav.contains("client.sendIntent(intent)"))
        assertTrue(nav.contains("DetailRequestIntent(it)"))
        assertTrue(nav.contains("MarkReadIntent(it)"))
        assertTrue(nav.contains("OpenOnPhoneIntent(it)"))
        assertTrue(activity.contains("class MainActivity : ComponentActivity()"))
        assertTrue(activity.contains("setContent { MaterialTheme { WatchNav() } }"))
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
