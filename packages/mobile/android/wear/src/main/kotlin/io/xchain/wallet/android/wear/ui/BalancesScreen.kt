// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode

@Composable
fun BalancesScreen(
    display: BalancesDisplay,
    mode: UnitsMode,
    isTestNetwork: Boolean,
    unread: Int,
    onModeChange: (UnitsMode) -> Unit,
    onAlerts: () -> Unit,
    onReceive: () -> Unit,
    onStatus: () -> Unit,
    onRequest: (() -> Unit)? = null,
) = BalancesScreen(
    display, mode, isTestNetwork, unread, onModeChange, onAlerts, onReceive, onStatus, onRequest,
) { balancesText(it) }

@Composable
internal fun BalancesScreen(
    display: BalancesDisplay,
    mode: UnitsMode,
    isTestNetwork: Boolean,
    unread: Int,
    onModeChange: (UnitsMode) -> Unit,
    onAlerts: () -> Unit,
    onReceive: () -> Unit,
    onStatus: () -> Unit,
    onRequest: (() -> Unit)? = null,
    text: @Composable (String) -> String,
) {
    val state = rememberTransformingLazyColumnState()
    val resolvedLabelText = mutableMapOf<String, String>()
    for (line in display.lines) {
        val lineKey = line.key
        if (lineKey != null) resolvedLabelText[lineKey] = text(lineKey)

        val primaryKey = line.primary?.key
        if (primaryKey != null) {
            resolvedLabelText[primaryKey] = text(primaryKey)
            if (primaryKey == "state.hidden") {
                resolvedLabelText[SpokenLabels.HIDDEN_KEY] = text(SpokenLabels.HIDDEN_KEY)
            }
        }

        val secondaryKey = line.secondary?.key
        if (secondaryKey != null) resolvedLabelText[secondaryKey] = text(secondaryKey)
    }
    val labels = AccessibilityLabels.balanceLines(display, resolvedLabelText::getValue)
    ScreenScaffold(scrollState = state) { padding ->
        TransformingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = state,
            contentPadding = padding,
            rotaryScrollableBehavior = RotaryScrollableDefaults.behavior(state),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { Head(unread, onAlerts, onReceive, onStatus, text) }
            display.header?.let { header ->
                item {
                    Text(
                        resolved(header, text),
                        modifier = Modifier.fillMaxWidth().clickable {
                            BalancesHeadRules.headerTap(mode, isTestNetwork)?.let(onModeChange)
                        },
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }
            onRequest?.let { open ->
                display.requestKey?.let { key ->
                    item { Text(text(key), Modifier.clickable(onClick = open)) }
                }
            }
            items(display.banners) { Text(text(it)) }
            display.ageLine?.let { key ->
                item {
                    val line = if (key == "state.ageAmber") {
                        StateBannerRules.AgeLine.AGE_AMBER
                    } else {
                        StateBannerRules.AgeLine.AGE
                    }
                    Age(line, text(key))
                }
            }
            items(display.lines.zip(labels)) { (line, label) -> BalanceLine(line, label, text) }
        }
    }
}

@Composable
private fun Head(
    unread: Int,
    onAlerts: () -> Unit,
    onReceive: () -> Unit,
    onStatus: () -> Unit,
    text: @Composable (String) -> String,
) = Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
    Button(onClick = onAlerts) {
        Box(contentAlignment = Alignment.TopEnd) {
            Text(text("w3.title"))
            if (BalancesHeadRules.showsUnreadDot(unread)) Text("•", color = Color.Red)
        }
    }
    Button(onClick = onReceive) { Text(text("w1.receive")) }
    Button(onClick = onStatus) { Text(text("state.status")) }
}

@Composable
private fun BalanceLine(
    line: BalanceLine,
    label: String,
    text: @Composable (String) -> String,
) {
    if (line.name == null) {
        Text(
            text(requireNotNull(line.key)),
            Modifier.semantics(mergeDescendants = true) { contentDescription = label },
        )
        return
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(line.name, Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End) {
            Text(resolved(requireNotNull(line.primary), text))
            line.secondary?.let { Text(resolved(it, text), style = MaterialTheme.typography.labelSmall) }
        }
    }
}

@Composable
private fun resolved(value: BalanceText, text: @Composable (String) -> String): String =
    value.text ?: text(requireNotNull(value.key))

@Composable
private fun balancesText(key: String): String = stringResource(
    when (key) {
        "state.age" -> R.string.state_age
        "state.ageAmber" -> R.string.state_age_amber
        "state.amountHidden" -> R.string.state_amount_hidden
        "state.balanceUnavailable" -> R.string.state_balance_unavailable
        "state.hidden" -> R.string.state_hidden
        "state.loading" -> R.string.state_loading
        "state.locked" -> R.string.state_locked
        "state.moreOnPhone" -> R.string.state_more_on_phone
        "state.status" -> R.string.state_status
        "state.stale24h" -> R.string.state_stale24h
        "state.unreachable" -> R.string.state_unreachable
        "state.watchDisabled" -> R.string.state_watch_disabled
        "w1.empty" -> R.string.w1_empty
        "w1.receive" -> R.string.w1_receive
        "w1.requestWaiting" -> R.string.w1_request_waiting
        "w1.title" -> R.string.w1_title
        "w3.title" -> R.string.w3_title
        else -> error("Unknown balances text: $key")
    },
)
