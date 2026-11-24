// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import io.xchain.wallet.android.wear.data.DataLayerClient
import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.DetailRequestIntent
import io.xchain.wallet.android.wear.data.MarkReadIntent
import io.xchain.wallet.android.wear.data.OpenOnPhoneIntent
import io.xchain.wallet.android.wear.data.Snapshot
import io.xchain.wallet.android.wear.data.SnapshotStore
import io.xchain.wallet.android.wear.data.WatchPrefs
import io.xchain.wallet.android.wear.nav.WatchScreenGraph.Screen
import io.xchain.wallet.android.wear.ui.AlertDetailScreen
import io.xchain.wallet.android.wear.ui.AlertsPresenter
import io.xchain.wallet.android.wear.ui.AlertsScreen
import io.xchain.wallet.android.wear.ui.BalancesPresenter
import io.xchain.wallet.android.wear.ui.BalancesScreen
import io.xchain.wallet.android.wear.ui.NotSetUpScreen
import io.xchain.wallet.android.wear.ui.ReceiveScreen
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
    val nav = rememberSwipeDismissableNavController()
    val start = WatchScreenGraph.root(snapshot != null, snapshot?.settings?.enabled ?: true)
    val unitDefault = snapshot?.unitDefault
    val isTest = snapshot?.network?.isTest ?: false
    var mode by remember(unitDefault, isTest) { mutableStateOf(prefs.unitsMode(unitDefault, isTest)) }
    var hideAmounts by remember { mutableStateOf(prefs.hideAmounts) }
    val redaction = rememberAmbientRedaction(snapshot?.hidden == true, hideAmounts)
    val shown = snapshot?.copy(hidden = redaction.redacted)
    val alerts = AlertsPresenter.present(snapshot?.inbox.orEmpty(), snapshot?.request, now)

    SwipeDismissableNavHost(navController = nav, startDestination = start.route()) {
        composable(Screen.BALANCES.route()) {
            BalancesScreen(
                BalancesPresenter.present(shown, mode, phoneReachable, now),
                mode,
                isTest,
                alerts.rows.count { it.unread },
                onModeChange = { mode = prefs.toggleUnits(unitDefault, isTest) },
                onAlerts = { nav.navigate(Screen.ALERTS.route()) },
                onReceive = { nav.navigate(Screen.RECEIVE.route()) },
                onStatus = { nav.navigate(Screen.STATUS.route()) },
                onRequest = snapshot?.request?.id?.takeIf(String::isNotEmpty)?.let { id ->
                    { nav.navigate(WatchNavRoutes.alertDetail(id)) }
                },
            )
        }
        composable(WatchNavRoutes.pattern(Screen.TOKEN_DETAIL)) { entry ->
            val id = entry.arguments?.getString(WatchNavRoutes.TOKEN_ID_ARG)
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
        }
        composable(Screen.ALERTS.route()) {
            AlertsScreen(alerts, now, { onMarkRead(it.id) }) { id ->
                nav.navigate(WatchNavRoutes.alertDetail(id))
            }
        }
        composable(WatchNavRoutes.pattern(Screen.ALERT_DETAIL)) { entry ->
            val id = entry.arguments?.getString(WatchNavRoutes.ALERT_ID_ARG)
            val request = alerts.request.takeIf { snapshot?.request?.id == id }
            AlertDetailScreen(alerts.rows.firstOrNull { it.id == id }, request) {
                id?.let(onOpenOnPhone)
            }
        }
        composable(Screen.RECEIVE.route()) { ReceiveScreen(snapshot?.receive.orEmpty()) }
        composable(Screen.STATUS.route()) {
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
        }
        composable(Screen.NOT_SET_UP.route()) {
            NotSetUpScreen(enabled = snapshot?.settings?.enabled ?: true)
        }
    }
}
