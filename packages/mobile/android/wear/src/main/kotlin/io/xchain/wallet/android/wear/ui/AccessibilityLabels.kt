// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

object AccessibilityLabels {
    fun balanceLines(display: BalancesDisplay, text: (String) -> String): List<String> =
        display.lines.map { line ->
            line.key?.let(text) ?: SpokenLabels.lines(
                line.name,
                line.primary?.spoken(text, primary = true),
                line.secondary?.spoken(text),
            )
        }

    fun requestPinned(display: RequestDisplay, text: (String) -> String): String =
        display.pinned.spoken(text)

    fun requestLines(
        display: RequestDisplay,
        text: (String) -> String,
        time: (Long) -> String,
    ): List<String> = display.lines.map { line ->
        SpokenLabels.lines(
            line.label?.spoken(text, time),
            line.value.spoken(text, time),
        )
    }

    private fun BalanceText.spoken(text: (String) -> String, primary: Boolean = false): String =
        this.text ?: text(
            if (primary && key == "state.hidden") SpokenLabels.HIDDEN_KEY else requireNotNull(key),
        )

    private fun AlertDisplayValue.spoken(text: (String) -> String): String =
        this.text ?: text(requireNotNull(key))

    private fun AlertDisplayValue.spoken(
        text: (String) -> String,
        time: (Long) -> String,
    ): String = this.text ?: key?.let(text) ?: time(requireNotNull(at))
}
