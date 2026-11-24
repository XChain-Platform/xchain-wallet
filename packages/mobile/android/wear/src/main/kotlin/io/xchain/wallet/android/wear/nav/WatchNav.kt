// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.nav

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.itemsIndexed
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.DataLayerClient
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.DetailRequestIntent
import io.xchain.wallet.android.wear.data.MarkReadIntent
import io.xchain.wallet.android.wear.data.OpenOnPhoneIntent
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode
import io.xchain.wallet.android.wear.data.WatchPrefs
import io.xchain.wallet.android.wear.nav.WatchScreenGraph.Screen
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.AlertsScreen
import io.xchain.wallet.android.wear.ui.Age
import io.xchain.wallet.android.wear.ui.BalanceLine
import io.xchain.wallet.android.wear.ui.BalanceText
import io.xchain.wallet.android.wear.ui.BalancesDisplay
import io.xchain.wallet.android.wear.ui.BalancesHeadRules
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.NotSetUpScreen
import io.xchain.wallet.android.wear.ui.ReceiveScreen
import io.xchain.wallet.android.wear.ui.StateBannerRules
import io.xchain.wallet.android.wear.ui.StatusRows
import io.xchain.wallet.android.wear.ui.StatusScreen
import io.xchain.wallet.android.wear.ui.TokenDetailPresenter
import io.xchain.wallet.android.wear.ui.TokenDetailScreen
import io.xchain.wallet.android.wear.ui.rememberAmbientRedaction
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement

@Composable
fun WatchNav() {
    val context = LocalContext.current
    val snapshot = remember(context) {
        SnapshotStore(context).latest?.let {
            runCatching { Json.decodeFromJsonElement<Snapshot>(it) }.getOrNull()
        }
    }
    val appVersion = remember(context) {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
    }
    val client = remember(context) { DataLayerClient(context) }
    val scope = rememberCoroutineScope()
    var reachable by remember { mutableStateOf(false) }
    LaunchedEffect(client, appVersion) {
        reachable = runCatching { client.start(appVersion) }.getOrDefault(false)
    }
    val send: (Any) -> Unit = { intent ->
        scope.launch { runCatching { client.sendIntent(intent) } }
    }
    WatchNav(
        snapshot,
        WatchPrefs(context),
        appVersion,
        phoneReachable = reachable,
        onRequestDetail = { send(DetailRequestIntent(it)) },
        onMarkRead = { send(MarkReadIntent(it)) },
        onOpenOnPhone = { send(OpenOnPhoneIntent(it)) },
    )
}

@Composable
internal fun WatchNav(
    snapshot: Snapshot?,
    prefs: WatchPrefs,
    appVersion: String,
    phoneReachable: Boolean = true,
    details: Map<String, Detail> = emptyMap(),
    artwork: (String) -> ByteArray? = { null },
    onRequestDetail: (String) -> Unit = {},
    onMarkRead: (String) -> Unit = {},
    onOpenOnPhone: (String) -> Unit = {},
    now: Long = System.currentTimeMillis(),
) {
    val start = WatchScreenGraph.root(snapshot != null, snapshot?.settings?.enabled ?: true)
    val unitDefault = snapshot?.unitDefault
    val isTest = snapshot?.network?.isTest ?: false
    var mode by remember(unitDefault, isTest) { mutableStateOf(prefs.unitsMode(unitDefault, isTest)) }
    var hideAmounts by remember { mutableStateOf(prefs.hideAmounts) }
    val redaction = rememberAmbientRedaction(snapshot?.hidden == true, hideAmounts)
    val shown = snapshot?.copy(hidden = redaction.redacted)
    val alerts = AlertsPresenter.present(snapshot?.inbox.orEmpty(), snapshot?.request, now)

    WatchNavGraph(
        start.route(),
        balances = { actions ->
            BalancesDestination(
                requireNotNull(snapshot),
                BalancesPresenter.present(shown, mode, phoneReachable, now),
                mode,
                isTest,
                alerts.rows.count { it.unread },
                onModeChange = { mode = prefs.toggleUnits(unitDefault, isTest) },
                onToken = actions::tokenDetail,
                onAlerts = actions::alerts,
                onReceive = actions::receive,
                onStatus = actions::status,
                onRequest = snapshot.request.id.takeIf(String::isNotEmpty)?.let { id ->
                    { actions.alertDetail(id) }
                },
            )
        },
        tokenDetail = { id ->
            snapshot?.rows?.firstOrNull { it.id == id }?.let { row ->
                val detail = details[row.id]
                LaunchedEffect(row.id, detail) {
                    if (detail == null) onRequestDetail(row.id)
                }
                val art = detail?.artworkHash?.let(artwork)
                TokenDetailScreen(
                    TokenDetailPresenter.present(
                        row,
                        detail,
                        phoneReachable,
                        detail?.artworkHash?.takeIf { art != null }?.let(::setOf).orEmpty(),
                        redaction.redacted,
                    ),
                    art,
                ) { onOpenOnPhone("token/${row.id}") }
            }
        },
        alerts = { actions ->
            AlertsScreen(alerts, now, { onMarkRead(it.id) }) { id ->
                actions.alertDetail(id)
            }
        },
        alertDetail = { id ->
            val request = alerts.request.takeIf { snapshot?.request?.id == id }
            AlertDetailScreen(alerts.rows.firstOrNull { it.id == id }, request) {
                id?.let(onOpenOnPhone)
            }
        },
        receive = { ReceiveScreen(snapshot?.receive.orEmpty()) },
        status = {
            StatusScreen(
                StatusRows.rows(
                    phoneReachable,
                    snapshot?.balancesAt,
                    snapshot?.session,
                    hideAmounts,
                    appVersion,
                ),
                onHideAmountsChange = {
                    hideAmounts = it
                    prefs.hideAmounts = it
                },
                now = now,
            )
        },
        notSetUp = {
            NotSetUpScreen(enabled = snapshot?.settings?.enabled ?: true)
        },
    )
}

internal class WatchNavActions(private val navigate: (String) -> Unit) {
    fun tokenDetail(id: String) = navigate(WatchNavRoutes.tokenDetail(id))
    fun alerts() = navigate(Screen.ALERTS.route())
    fun alertDetail(id: String) = navigate(WatchNavRoutes.alertDetail(id))
    fun receive() = navigate(Screen.RECEIVE.route())
    fun status() = navigate(Screen.STATUS.route())
}

@Composable
internal fun WatchNavGraph(
    startDestination: String,
    balances: @Composable (WatchNavActions) -> Unit,
    tokenDetail: @Composable (String?) -> Unit,
    alerts: @Composable (WatchNavActions) -> Unit,
    alertDetail: @Composable (String?) -> Unit,
    receive: @Composable () -> Unit,
    status: @Composable () -> Unit,
    notSetUp: @Composable () -> Unit,
) {
    val nav = rememberSwipeDismissableNavController()
    val actions = remember(nav) { WatchNavActions(nav::navigate) }
    SwipeDismissableNavHost(navController = nav, startDestination = startDestination) {
        composable(Screen.BALANCES.route()) { balances(actions) }
        composable(WatchNavRoutes.pattern(Screen.TOKEN_DETAIL)) { entry ->
            tokenDetail(entry.arguments?.getString(WatchNavRoutes.TOKEN_ID_ARG))
        }
        composable(Screen.ALERTS.route()) { alerts(actions) }
        composable(WatchNavRoutes.pattern(Screen.ALERT_DETAIL)) { entry ->
            alertDetail(entry.arguments?.getString(WatchNavRoutes.ALERT_ID_ARG))
        }
        composable(Screen.RECEIVE.route()) { receive() }
        composable(Screen.STATUS.route()) { status() }
        composable(Screen.NOT_SET_UP.route()) { notSetUp() }
    }
}

@Composable
internal fun BalancesDestination(
    snapshot: Snapshot,
    display: BalancesDisplay,
    mode: UnitsMode,
    isTestNetwork: Boolean,
    unread: Int,
    onModeChange: (UnitsMode) -> Unit,
    onToken: (String) -> Unit,
    onAlerts: () -> Unit,
    onReceive: () -> Unit,
    onStatus: () -> Unit,
    onRequest: (() -> Unit)?,
    text: @Composable (String) -> String = ::balancesText,
) {
    val state = rememberTransformingLazyColumnState()
    ScreenScaffold(scrollState = state) { padding ->
        TransformingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            state = state,
            contentPadding = padding,
            rotaryScrollableBehavior = RotaryScrollableDefaults.behavior(state),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    Button(onClick = onAlerts) {
                        Box(contentAlignment = Alignment.TopEnd) {
                            Text(text("w3.title"))
                            if (unread > 0) Text("•", color = Color.Red)
                        }
                    }
                    Button(onClick = onReceive) { Text(text("w1.receive")) }
                    Button(onClick = onStatus) { Text(text("state.status")) }
                }
            }
            display.header?.let { header ->
                item {
                    Text(
                        resolved(header, text),
                        Modifier.fillMaxWidth().clickable {
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
            itemsIndexed(display.lines) { index, line ->
                BalanceDestinationLine(line, text) {
                    snapshot.rows.getOrNull(index)?.let { onToken(it.id) }
                }
            }
        }
    }
}

@Composable
private fun BalanceDestinationLine(
    line: BalanceLine,
    text: @Composable (String) -> String,
    onClick: () -> Unit,
) {
    if (line.name == null) {
        Text(text(requireNotNull(line.key)))
        return
    }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(line.name, Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End) {
            Text(resolved(requireNotNull(line.primary), text))
            line.secondary?.let {
                Text(resolved(it, text), style = MaterialTheme.typography.labelSmall)
            }
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
