// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import io.xchain.wallet.android.wear.data.DetailFact

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

    fun requestPinned(key: String, text: (String) -> String): String = text(key)

    fun alertRow(alert: AlertDisplay, time: String): String =
        SpokenLabels.lines(alert.title, alert.body, time)

    fun alertDetail(alert: AlertDisplay, time: String): String = alertRow(alert, time)

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

    fun tokenIdentity(display: TokenDetailDisplay): String =
        SpokenLabels.lines(display.displayName, display.tick)

    fun tokenAmount(display: TokenDetailDisplay, showsValue: Boolean, hiddenText: String): String {
        val amount = (if (showsValue) display.valueText else display.amountText)
            .let { if (it == AmbientRedaction.DOTS) hiddenText else it }
        return SpokenLabels.lines(display.displayName, amount)
    }

    fun fact(fact: DetailFact): String = SpokenLabels.lines(fact.label, fact.value)

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
