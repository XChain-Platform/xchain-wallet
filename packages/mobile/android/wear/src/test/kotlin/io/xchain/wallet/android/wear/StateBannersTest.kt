package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.xchain.wallet.android.wear.ui.Age
import io.xchain.wallet.android.wear.ui.Hidden
import io.xchain.wallet.android.wear.ui.StateBannerRules.AgeLine
import io.xchain.wallet.android.wear.ui.StateBannerRules.Banner
import io.xchain.wallet.android.wear.ui.StateBanners
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StateBannersTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun rendersEveryBannerKind() {
        val text = mapOf(
            Banner.LOADING to "Waiting for phone",
            Banner.LOCKED to "Wallet locked on phone",
            Banner.UNREACHABLE to "Phone not in range",
            Banner.STALE_24H to "Open XChain Wallet on your phone to refresh",
        )
        activity.setContent {
            StateBanners(Banner.entries, textFor = { text.getValue(it) })
        }

        listOf(
            "Waiting for phone",
            "Wallet locked on phone",
            "Phone not in range",
            "Open XChain Wallet on your phone to refresh",
        ).forEach { compose.onNodeWithText(it).assertIsDisplayed() }
    }

    @Test
    fun rendersBothAgeKinds() {
        activity.setContent {
            Column {
                Age(AgeLine.AGE, "Updated just now")
                Age(AgeLine.AGE_AMBER, "Updated 16 min ago")
            }
        }

        compose.onNodeWithText("Updated just now").assertIsDisplayed()
        compose.onNodeWithText("Updated 16 min ago").assertIsDisplayed()
    }

    @Test
    fun rendersHiddenWhenRequested() {
        activity.setContent { Hidden(hidden = true, hiddenText = { "••••" }) }

        compose.onNodeWithText("••••").assertIsDisplayed()
    }

    @Test
    fun omitsHiddenWhenNotRequested() {
        activity.setContent { Hidden(hidden = false, hiddenText = { "••••" }) }

        compose.onNodeWithText("••••").assertDoesNotExist()
    }
}
