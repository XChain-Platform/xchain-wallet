package io.xchain.wallet.android.wear.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.Text
import androidx.wear.remote.interactions.RemoteActivityHelper
import io.xchain.wallet.android.wear.R

@Composable
fun NotSetUpScreen(enabled: Boolean = true) {
    val context = LocalContext.current
    val helper = remember(context) { RemoteActivityHelper(context, context.mainExecutor) }
    NotSetUpScreen(
        message = stringResource(if (enabled) R.string.state_open_wallet_on_phone else R.string.state_watch_disabled),
        action = stringResource(R.string.state_open_on_phone),
    ) { helper.startRemoteActivity(openPhoneIntent(), null) }
}

@Composable
internal fun NotSetUpScreen(message: String, action: String, onOpenOnPhone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = message,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onOpenOnPhone) { Text(action) }
    }
}

internal fun openPhoneIntent(): Intent = Intent(Intent.ACTION_VIEW)
    .setData(Uri.parse("xchain://"))
    .addCategory(Intent.CATEGORY_BROWSABLE)
