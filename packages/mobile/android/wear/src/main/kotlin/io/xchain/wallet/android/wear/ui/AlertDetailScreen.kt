// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import java.text.DateFormat
import java.util.Date

@Composable
fun AlertDetailScreen(
    alert: AlertDisplay?,
    request: RequestDisplay?,
    onOpenOnPhone: () -> Unit,
) {
    AlertDetailScreen(alert, request, onOpenOnPhone, ::alertDetailText) {
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
            .format(Date(it))
    }
}

@Composable
internal fun AlertDetailScreen(
    alert: AlertDisplay?,
    request: RequestDisplay?,
    onOpenOnPhone: () -> Unit,
    text: @Composable (String) -> String,
    formatAt: (Long) -> String,
) {
    val family = alert?.family ?: "request"
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Text(
                familyGlyph(family),
                modifier = Modifier.semantics {
                    contentDescription = AlertFamilyIcon.phoneIcon(family)
                },
            )
        }
        item { Text(alert?.title ?: text("w4.title")) }
        alert?.body?.let { body -> item { Text(body) } }
        alert?.let { item { Text(formatAt(it.at)) } }
        request?.let { display ->
            items(display.lines) { line ->
                Column {
                    line.label?.let {
                        Text(resolve(it, text, formatAt), style = MaterialTheme.typography.labelSmall)
                    }
                    Text(resolve(line.value, text, formatAt))
                }
            }
        }
        item {
            Button(onClick = onOpenOnPhone, modifier = Modifier.fillMaxWidth()) {
                Text(text("w4.openOnPhone"))
            }
        }
    }
}

@Composable
private fun resolve(
    value: AlertDisplayValue,
    text: @Composable (String) -> String,
    formatAt: (Long) -> String,
): String = value.text ?: value.at?.let(formatAt) ?: text(requireNotNull(value.key))

private fun familyGlyph(family: String?): String = when (AlertFamilyIcon.phoneIcon(family)) {
    "SendIcon" -> "↗"
    "DownloadIcon" -> "↓"
    "ClockIcon" -> "◷"
    "MessageIcon" -> "✉"
    "ListIcon" -> "≡"
    "CoinsIcon" -> "\$"
    "TokenIcon" -> "○"
    "LineChartIcon" -> "⌁"
    "DocumentIcon" -> "▤"
    else -> "●"
}

@Composable
private fun alertDetailText(key: String): String = stringResource(
    when (key) {
        "w4.title" -> R.string.w4_title
        "w4.openOnPhone" -> R.string.w4_open_on_phone
        "w4.requestSentence" -> R.string.w4_request_sentence
        "w4.requestAmount" -> R.string.w4_request_amount
        "w4.requestExpired" -> R.string.w4_request_expired
        "w4.requestExpiry" -> R.string.w4_request_expiry
        else -> error("Unknown alert detail text: $key")
    },
)
