package io.xchain.wallet.android.wear

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import io.xchain.wallet.android.wear.data.DetailChart
import io.xchain.wallet.android.wear.ui.PriceLine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PriceLineTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    }

    @Test
    fun rendersDetailNativeChart() {
        val fixture = checkNotNull(javaClass.classLoader?.getResource("detail-native.json")).readText()
        val chartJson = Json.parseToJsonElement(fixture).jsonObject.getValue("chart")
        val chart = Json.decodeFromJsonElement(DetailChart.serializer(), chartJson)

        activity.setContent {
            PriceLine(chart, Modifier.size(width = 160.dp, height = 80.dp).testTag("price-line"))
        }

        assertEquals(48, chart.points.size)
        assertFalse(chart.up)
        compose.onNodeWithTag("price-line").assertIsDisplayed()
    }
}
