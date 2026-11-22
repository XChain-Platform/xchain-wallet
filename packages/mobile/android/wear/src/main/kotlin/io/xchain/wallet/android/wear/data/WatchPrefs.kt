package io.xchain.wallet.android.wear.data

import android.content.Context
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode

class WatchPrefs(context: Context) {
    private val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun unitsMode(unitDefault: String?, isTest: Boolean): UnitsMode =
        WatchDisplayRules.resolve(storedUnitsMode(), unitDefault, isTest)

    fun toggleUnits(unitDefault: String?, isTest: Boolean): UnitsMode {
        val mode = WatchDisplayRules.toggled(unitsMode(unitDefault, isTest), isTest)
        if (WatchDisplayRules.canToggle(isTest)) {
            preferences.edit().putString(UNITS_MODE_KEY, mode.name).apply()
        }
        return mode
    }

    var hideAmounts: Boolean
        get() = preferences.getBoolean(HIDE_AMOUNTS_KEY, false)
        set(value) = preferences.edit().putBoolean(HIDE_AMOUNTS_KEY, value).apply()

    private fun storedUnitsMode(): UnitsMode? =
        preferences.getString(UNITS_MODE_KEY, null)?.let { value ->
            UnitsMode.entries.firstOrNull { it.name == value }
        }

    internal companion object {
        const val PREFS_NAME = "watch_prefs"
        private const val UNITS_MODE_KEY = "units_mode"
        private const val HIDE_AMOUNTS_KEY = "hide_amounts"
    }
}
