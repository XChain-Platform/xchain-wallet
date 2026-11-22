package io.xchain.wallet.android.wear

import android.content.Context
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.data.WatchPrefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class WatchPrefsTest {
    private lateinit var context: Context

    @Before
    fun clearPreferences() {
        context = RuntimeEnvironment.getApplication()
        context.deleteSharedPreferences(WatchPrefs.PREFS_NAME)
    }

    @Test
    fun unitsModeSeedsFromSnapshotAndPersistsToggles() {
        val prefs = WatchPrefs(context)

        assertEquals(UnitsMode.UNITS, prefs.unitsMode("units", isTest = false))
        assertEquals(UnitsMode.FIAT, prefs.toggleUnits("units", isTest = false))
        assertEquals(UnitsMode.FIAT, WatchPrefs(context).unitsMode("units", isTest = false))
        assertEquals(UnitsMode.UNITS, prefs.toggleUnits("fiat", isTest = false))
        assertEquals(UnitsMode.UNITS, WatchPrefs(context).unitsMode("fiat", isTest = false))
    }

    @Test
    fun testNetworkForcesUnitsWithoutReplacingStoredMode() {
        val prefs = WatchPrefs(context)
        assertEquals(UnitsMode.FIAT, prefs.unitsMode("fiat", isTest = false))
        assertEquals(UnitsMode.UNITS, prefs.toggleUnits("fiat", isTest = true))
        assertEquals(UnitsMode.FIAT, WatchPrefs(context).unitsMode("fiat", isTest = false))
    }

    @Test
    fun hideAmountsDefaultsOffAndPersists() {
        val prefs = WatchPrefs(context)
        assertFalse(prefs.hideAmounts)

        prefs.hideAmounts = true
        assertTrue(WatchPrefs(context).hideAmounts)

        WatchPrefs(context).hideAmounts = false
        assertFalse(prefs.hideAmounts)
    }
}
