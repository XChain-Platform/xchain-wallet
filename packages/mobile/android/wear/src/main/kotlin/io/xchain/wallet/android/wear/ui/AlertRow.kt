// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.RelativeTimeKeys
import io.xchain.wallet.android.wear.data.WatchAge

@Composable
fun AlertRow(alert: AlertDisplay, now: Long, onOpen: () -> Unit) =
    AlertRow(alert, now, onOpen, ::alertRowText)

@Composable
internal fun AlertRow(
    alert: AlertDisplay,
    now: Long,
    onOpen: () -> Unit,
    text: @Composable (String) -> String,
) {
    val age = WatchAge.of(alert.at, now)
    val key = RelativeTimeKeys.alertKey(age.bucket.id(), age.n.toInt())
    val time = RelativeTimeKeys.fill(text(key.key), key.n)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).semantics(mergeDescendants = true) {
            contentDescription = AccessibilityLabels.alertRow(alert, time)
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            familyGlyph(alert.family),
            Modifier.semantics { contentDescription = AlertFamilyIcon.phoneIcon(alert.family) },
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(alert.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            alert.body?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Text(time, style = MaterialTheme.typography.labelSmall)
        }
        if (alert.unread) {
            Box(
                Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape)
                    .testTag("alertUnreadDot"),
            ) {}
        }
    }
}

@Composable
private fun alertRowText(key: String): String = stringResource(
    when (key) {
        "w3.timeJustNow" -> R.string.w3_time_just_now
        "w3.timeMinutes" -> R.string.w3_time_minutes
        "w3.timeHours" -> R.string.w3_time_hours
        "w3.timeDays" -> R.string.w3_time_days
        else -> error("Unknown alert row text: $key")
    },
)
