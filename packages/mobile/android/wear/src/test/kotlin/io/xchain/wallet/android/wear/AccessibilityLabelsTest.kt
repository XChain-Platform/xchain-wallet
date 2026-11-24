package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.ui.AccessibilityLabels
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class AccessibilityLabelsTest {
    private val json = Json

    @Test
    fun everyExpectedModelHasItsSharedAccessibilityLabels() {
        val expectedFile = resource("expected/balances.json")
        val expected = expectedFile.readText().let(json::parseToJsonElement).jsonObject
        val stringsFile = repositoryRoot(expectedFile)
            .resolve("packages/core/src/watch/contract/strings-balances.json")
        val strings = stringsFile.readText().let(json::parseToJsonElement).jsonObject
            .mapValues { (_, value) -> value.jsonPrimitive.content }

        expected.forEach { (fixture, fixtureElement) ->
            val models = fixtureElement.jsonObject
            listOf("fiat", "units").forEach { mode ->
                val model = models.getValue(mode).jsonObject
                val lines = model.getValue("lines").jsonArray.map { it.jsonObject.balanceLine() }
                val wanted = model["a11y"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()

                assertEquals(
                    "$fixture $mode",
                    wanted,
                    AccessibilityLabels.balanceLines(display(lines)) { strings.getValue(it) },
                )
            }
        }
    }

    @Test
    fun handBuiltLinesCoverEverySpokenForm() {
        val translations = mapOf(
            "w1.empty" to "No balances yet",
            "state.amountHidden" to "Amount hidden",
            "state.balanceUnavailable" to "Balance unavailable",
        )
        val text: (String) -> String = { translations.getValue(it) }

        assertEquals(
            listOf("No balances yet"),
            AccessibilityLabels.balanceLines(display(BalanceLine(key = "w1.empty")), text),
        )
        assertEquals(
            listOf("Bitcoin, Amount hidden"),
            AccessibilityLabels.balanceLines(
                display(BalanceLine(name = "Bitcoin", primary = BalanceText(key = "state.hidden"))),
                text,
            ),
        )
        assertEquals(
            listOf("Bitcoin, Balance unavailable"),
            AccessibilityLabels.balanceLines(
                display(
                    BalanceLine(
                        name = "Bitcoin",
                        primary = BalanceText(key = "state.balanceUnavailable"),
                    ),
                ),
                text,
            ),
        )
        assertEquals(
            listOf("Pepe Cash, No price yet, 1,000 PEPECASH"),
            AccessibilityLabels.balanceLines(
                display(
                    BalanceLine(
                        name = "Pepe Cash",
                        primary = BalanceText(text = "No price yet"),
                        secondary = BalanceText(text = "1,000 PEPECASH"),
                    ),
                ),
                text,
            ),
        )
    }

    private fun repositoryRoot(expectedFile: File): File =
        generateSequence(expectedFile.parentFile) { it.parentFile }
            .firstOrNull { it.resolve("test/fixtures/watch/expected/balances.json").isFile }
            ?: error("Repository root not found from $expectedFile")

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)

    private fun JsonObject.balanceLine() = BalanceLine(
        name = optionalString("name"),
        primary = balanceText("primary"),
        secondary = balanceText("secondary"),
        key = optionalString("key"),
    )

    private fun JsonObject.balanceText(name: String): BalanceText? =
        (this[name] as? JsonObject)?.let {
            BalanceText(key = it.optionalString("key"), text = it.optionalString("text"))
        }

    private fun JsonObject.optionalString(name: String): String? =
        this[name]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content

    private fun display(lines: List<BalanceLine>) = BalancesDisplay(
        header = null,
        lines = lines,
        banners = emptyList(),
        ageLine = null,
        requestKey = null,
    )

    private fun display(vararg lines: BalanceLine) = display(lines.toList())
}
