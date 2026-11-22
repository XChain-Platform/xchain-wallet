// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import io.xchain.wallet.android.wear.data.SnapshotQr
import io.xchain.wallet.android.wear.data.SnapshotReceive
import io.xchain.wallet.android.wear.ui.ReceiveScreen
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ReceiveScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun pagesThroughChainsWithAddresses() {
        activity.setContent {
            ReceiveScreen(
                listOf(receive("Bitcoin", "bc1q abcd"), receive("Ethereum", "0x12 3456")),
                emptyText = "Open the phone once",
            )
        }

        compose.onNodeWithText("Bitcoin").assertIsDisplayed()
        compose.onNodeWithText("bc1q abcd").assertIsDisplayed()
        compose.onRoot().performTouchInput { swipeUp() }
        compose.onNodeWithText("Ethereum").assertIsDisplayed()
        compose.onNodeWithText("0x12 3456").assertIsDisplayed()
    }

    @Test
    fun omitsMissingAddressesAndShowsTheEmptyPrompt() {
        activity.setContent {
            ReceiveScreen(listOf(receive("Bitcoin", "")), emptyText = "Open the phone once")
        }

        compose.onNodeWithText("Open the phone once").assertIsDisplayed()
    }

    private fun receive(label: String, address: String) = SnapshotReceive(
        chainId = label.lowercase(),
        label = label,
        address = address,
        qr = SnapshotQr(size = 1, bits = "gA=="),
    )
}
