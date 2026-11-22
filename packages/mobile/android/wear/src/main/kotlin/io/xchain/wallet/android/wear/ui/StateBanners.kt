package io.xchain.wallet.android.wear.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import io.xchain.wallet.android.wear.R
import io.xchain.wallet.android.wear.ui.StateBannerRules.AgeLine
import io.xchain.wallet.android.wear.ui.StateBannerRules.Banner

private val AgeAmber = Color(0xFFFFB300)

@Composable
fun StateBanners(banners: List<Banner>, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        banners.forEach { banner ->
            Text(
                text = stringResource(banner.stringRes()),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
fun Age(line: AgeLine, text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        color = if (line == AgeLine.AGE_AMBER) AgeAmber else MaterialTheme.colorScheme.onBackground,
        style = MaterialTheme.typography.labelSmall,
    )
}

@Composable
fun Hidden(hidden: Boolean, modifier: Modifier = Modifier) {
    if (hidden) {
        Text(text = stringResource(R.string.state_hidden), modifier = modifier)
    }
}

@StringRes
private fun Banner.stringRes(): Int = when (this) {
    Banner.LOADING -> R.string.state_loading
    Banner.LOCKED -> R.string.state_locked
    Banner.UNREACHABLE -> R.string.state_unreachable
    Banner.STALE_24H -> R.string.state_stale24h
}
