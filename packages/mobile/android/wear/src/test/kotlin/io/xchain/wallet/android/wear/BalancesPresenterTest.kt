package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.WatchDisplayRules
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BalancesPresenterTest {
    private val json = Json

    @Test
    fun everySnapshotMatchesTheSharedExpectedModels() {
        val expected = resource("expected/balances.json").readText()
            .let(json::parseToJsonElement) as JsonObject

        fixtures().forEach { file ->
            val snapshot = json.decodeFromString<Snapshot>(file.readText())
            val name = file.nameWithoutExtension
            val models = expected.getValue(name) as JsonObject
            listOf(
                "fiat" to WatchDisplayRules.UnitsMode.FIAT,
                "units" to WatchDisplayRules.UnitsMode.UNITS,
            ).forEach { (key, mode) ->
                val display = BalancesPresenter.present(snapshot, mode, now = snapshot.builtAt)
                assertEquals("$name $key", models.getValue(key), display.balanceJson())
            }
        }
    }

    @Test
    fun loadingAndReachabilityProduceStateBanners() {
        assertEquals(listOf("state.loading"), BalancesPresenter.present(null).banners)

        val snapshot = fixture("snapshot-empty.json")
        val display = BalancesPresenter.present(snapshot, phoneReachable = false, now = snapshot.builtAt)
        assertEquals(listOf("state.unreachable"), display.banners)
    }

    @Test
    fun unavailableRowsOverrideAmounts() {
        val snapshot = fixture("snapshot-unpriced.json")
        val unavailable = snapshot.copy(rows = listOf(snapshot.rows.single().copy(unavailable = true)))
        val line = BalancesPresenter.present(
            unavailable,
            WatchDisplayRules.UnitsMode.FIAT,
            now = snapshot.builtAt,
        ).lines.single()

        assertEquals(BalanceText(key = "state.balanceUnavailable"), line.primary)
        assertNull(line.secondary)
    }

    @Test
    fun enabledSnapshotsExposeThePinnedRequest() {
        val enabled = fixture("snapshot-empty.json")
        val disabled = fixture("snapshot-disabled.json")

        assertEquals("w1.requestWaiting", BalancesPresenter.present(enabled).requestKey)
        assertNull(BalancesPresenter.present(disabled).requestKey)
    }

    private fun fixture(name: String): Snapshot =
        json.decodeFromString(resource(name).readText())

    private fun fixtures(): List<File> {
        val first = resource("snapshot-empty.json")
        val directory = requireNotNull(first.parentFile)
        return requireNotNull(directory.listFiles())
            .filter { it.isFile && it.name.startsWith("snapshot-") && it.extension == "json" }
            .sortedBy { it.name }
            .also { assertTrue("No snapshot fixtures found", it.isNotEmpty()) }
    }

    private fun resource(name: String): File =
        checkNotNull(javaClass.classLoader?.getResource(name)).toURI().let(::File)

    private fun BalancesDisplay.balanceJson() = buildJsonObject {
        put("header", header?.json() ?: JsonNull)
        put("lines", buildJsonArray { lines.forEach { add(it.json()) } })
        put("banners", buildJsonArray { banners.forEach { add(JsonPrimitive(it)) } })
        put("ageLine", ageLine?.let(::JsonPrimitive) ?: JsonNull)
    }

    private fun BalanceLine.json() = buildJsonObject {
        if (name != null) {
            put("name", JsonPrimitive(name))
            put("primary", requireNotNull(primary).json())
            put("secondary", secondary?.json() ?: JsonNull)
        } else {
            put("key", JsonPrimitive(requireNotNull(key)))
        }
    }

    private fun BalanceText.json() = buildJsonObject {
        key?.let { put("key", JsonPrimitive(it)) }
        text?.let { put("text", JsonPrimitive(it)) }
    }
}
