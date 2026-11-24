// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.MarkReadIntent

@Composable
fun AlertsScreen(
    display: AlertsDisplay,
    now: Long,
    markRead: (MarkReadIntent) -> Unit,
    onOpen: (String) -> Unit,
) = AlertsScreen(display, now, markRead, onOpen, ::alertsText)

@Composable
internal fun AlertsScreen(
    display: AlertsDisplay,
    now: Long,
    markRead: (MarkReadIntent) -> Unit,
    onOpen: (String) -> Unit,
    text: @Composable (String) -> String,
) {
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { Text(text("w3.title")) }
        display.emptyTextKey?.let { key ->
            item { Text(text(key)) }
        } ?: items(display.rows, key = { it.id }) { alert ->
            AlertRow(
                alert = alert,
                now = now,
                onOpen = {
                    markRead(MarkReadIntent(alert.id))
                    onOpen(alert.id)
                },
                text = text,
            )
        }
    }
}

@Composable
private fun alertsText(key: String): String = stringResource(
    when (key) {
        "w3.title" -> R.string.w3_title
        "w3.empty" -> R.string.w3_empty
        "w3.timeJustNow" -> R.string.w3_time_just_now
        "w3.timeMinutes" -> R.string.w3_time_minutes
        "w3.timeHours" -> R.string.w3_time_hours
        "w3.timeDays" -> R.string.w3_time_days
        else -> error("Unknown alerts text: $key")
    },
)
