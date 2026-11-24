// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import io.xchain.wallet.android.wear.ui.AlertDisplay
import io.xchain.wallet.android.wear.ui.AlertRow
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.internal.ManifestFactory
import org.robolectric.internal.ManifestIdentifier

@RunWith(AlertRowSemanticsTestRunner::class)
@Config(sdk = [35])
class AlertRowSemanticsTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun unreadAlertIncludesTitleBodyAndTime() {
        show(alert(body = "Complete your payment", unread = true, at = NOW - 2 * HOUR))

        compose.onNode(
            hasContentDescription("Payment due, Complete your payment, 2 h ago"),
        ).assertIsDisplayed()
    }

    @Test
    fun readAlertWithNullBodyIncludesTitleAndTime() {
        show(alert(body = null, unread = false, at = NOW - HOUR))

        compose.onNode(hasContentDescription("Payment due, 1 h ago")).assertIsDisplayed()
    }

    private fun show(alert: AlertDisplay) {
        activity.setContent { AlertRow(alert, NOW) {} }
    }

    private fun alert(
        body: String? = "Complete your payment",
        unread: Boolean = false,
        at: Long = NOW,
    ) = AlertDisplay("alert-1", "paydue", "Payment due", body, at, unread)

    private companion object {
        const val NOW = 1_700_000_000_000L
        const val HOUR = 3_600_000L
    }
}

class AlertRowSemanticsTestRunner(testClass: Class<*>) : RobolectricTestRunner(testClass) {
    override fun getManifestFactory(config: Config): ManifestFactory {
        val root = Path.of(System.getProperty("user.dir"))
        val main = listOf(
            root.resolve("src/main"),
            root.resolve("wear/src/main"),
            root.resolve("packages/mobile/android/wear/src/main"),
        ).first(Files::isDirectory)
        val module = main.parent.parent
        val resourceApk = module.resolve(
            "build/intermediates/linked_resources_binary_format/debug/processDebugResources/" +
                "linked-resources-binary-format-debug.ap_",
        )
        return ManifestFactory {
            ManifestIdentifier(
                "io.xchain.wallet.android.wear",
                main.resolve("AndroidManifest.xml"),
                null,
                null,
                emptyList(),
                resourceApk,
            )
        }
    }
}
