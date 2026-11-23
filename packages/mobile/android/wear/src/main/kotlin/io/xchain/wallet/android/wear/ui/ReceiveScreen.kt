// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.pager.VerticalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.data.SnapshotReceive

@Composable
fun ReceiveScreen(receive: List<SnapshotReceive>) =
    ReceiveScreen(receive, stringResource(R.string.w6_empty))

@Composable
internal fun ReceiveScreen(receive: List<SnapshotReceive>, emptyText: String) {
    val pages = remember(receive) { receive.filter { it.address.isNotBlank() } }
    if (pages.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) { Text(emptyText, textAlign = TextAlign.Center) }
        return
    }

    val state = rememberPagerState(pageCount = pages::size)
    VerticalPager(state = state, key = { pages[it].chainId }) { page ->
        val item = pages[page]
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(TokenGlyph.letter(item.label))
            Text(item.label)
            Qr(item.qr, Modifier.size(112.dp))
            Text(item.address, textAlign = TextAlign.Center)
        }
    }
}
