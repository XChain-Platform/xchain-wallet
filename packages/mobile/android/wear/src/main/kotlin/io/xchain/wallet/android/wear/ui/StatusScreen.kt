package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.SwitchButton
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.RelativeTimeKeys
import io.xchain.wallet.android.wear.data.WatchAge

@Composable
fun StatusScreen(
    rows: List<StatusRows.Row>,
    onHideAmountsChange: (Boolean) -> Unit,
    now: Long = System.currentTimeMillis(),
) = StatusScreen(rows, onHideAmountsChange, now) { statusText(it) }

@Composable
internal fun StatusScreen(
    rows: List<StatusRows.Row>,
    onHideAmountsChange: (Boolean) -> Unit,
    now: Long = System.currentTimeMillis(),
    text: @Composable (String) -> String,
) {
    TransformingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { Text(text(StatusRows.TITLE_KEY)) }
        items(rows, key = { it.labelKey }) { row ->
            if (row.kind == StatusRows.Kind.TOGGLE) {
                SwitchButton(
                    checked = row.on,
                    onCheckedChange = onHideAmountsChange,
                    label = { Text(text(row.labelKey)) },
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text(row.labelKey), modifier = Modifier.weight(1f))
                    value(row, now, text)
                }
            }
        }
    }
}

@Composable
private fun value(row: StatusRows.Row, now: Long, text: @Composable (String) -> String) {
    when (row.kind) {
        StatusRows.Kind.FLAG -> Text(if (row.on) "✓" else text("state.unreachable"))
        StatusRows.Kind.AGE -> {
            val age = WatchAge.of(requireNotNull(row.balancesAt), now)
            val key = RelativeTimeKeys.ageKey(age.bucket.id(), age.n.toInt())
            Text(
                RelativeTimeKeys.fill(text(key.key), key.n),
                color = if (age.amber) Color(0xFFE8A100) else Color.Unspecified,
            )
        }
        StatusRows.Kind.NONE -> Text("-")
        StatusRows.Kind.SESSION -> Text(if (row.on) text("state.locked") else "✓")
        StatusRows.Kind.SESSION_UNKNOWN -> Text(text("state.sessionUnknown"))
        StatusRows.Kind.TEXT -> Text(row.text.orEmpty())
        StatusRows.Kind.TOGGLE -> Unit
    }
}

@Composable
private fun statusText(key: String): String = stringResource(
    when (key) {
        "state.status" -> R.string.state_status
        "state.phoneReachable" -> R.string.state_phone_reachable
        "state.lastSync" -> R.string.state_last_sync
        "state.session" -> R.string.state_session
        "state.hideAmounts" -> R.string.state_hide_amounts
        "state.version" -> R.string.state_version
        "state.sessionUnknown" -> R.string.state_session_unknown
        "state.locked" -> R.string.state_locked
        "state.unreachable" -> R.string.state_unreachable
        "state.ageJustNow" -> R.string.state_age_just_now
        "state.ageMinutes" -> R.string.state_age_minutes
        "state.ageHours" -> R.string.state_age_hours
        "state.stale24h" -> R.string.state_stale24h
        else -> error("Unknown status text: $key")
    },
)
