package io.xchain.wallet.android.wear

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.xchain.wallet.android.wear.ui.NotSetUpScreen
import io.xchain.wallet.android.wear.ui.openPhoneIntent
import org.junit.Before
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotSetUpScreenTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun opensPhoneFromInitialPrompt() {
        var opens = 0
        activity.setContent {
            NotSetUpScreen(
                message = "Open XChain Wallet on your phone",
                action = "Open on phone",
            ) { opens++ }
        }

        compose.onNodeWithText("Open XChain Wallet on your phone").assertIsDisplayed()
        compose.onNodeWithText("Open on phone").performClick()
        compose.runOnIdle { assertEquals(1, opens) }
    }

    @Test
    fun explainsWhenWatchIsDisabled() {
        activity.setContent {
            NotSetUpScreen(
                message = "Show wallet on watch is off on your phone",
                action = "Open on phone",
            ) {}
        }

        compose.onNodeWithText("Show wallet on watch is off on your phone").assertIsDisplayed()
    }

    @Test
    fun remoteIntentTargetsThePhoneApp() {
        val intent = openPhoneIntent()

        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("xchain", intent.data?.scheme)
        assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE))
    }
}
