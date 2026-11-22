// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

package io.xchain.wallet.android.wear.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class RequestKind {
    @SerialName("request")
    REQUEST,

    @SerialName("paydue")
    PAYDUE,
}

@Serializable
data class Request(
    val id: String,
    val kind: RequestKind,
    val iconHash: String,
    val sentence: String,
    val amountText: String,
    val expiresAt: Long? = null,
)

@Serializable
data class Detail(
    val v: Int,
    val tokenId: String,
    val artworkHash: String? = null,
    val changeText: String? = null,
    val priceSourceText: String? = null,
    val chart: DetailChart? = null,
    val facts: List<DetailFact>? = null,
    val description: String? = null,
)

@Serializable
data class DetailChart(
    val points: List<Double>,
    val up: Boolean,
)

@Serializable
data class DetailFact(
    val label: String,
    val value: String,
)

@Serializable
class RefreshIntent

@Serializable
data class DetailRequestIntent(
    val tokenId: String,
)

@Serializable
data class OpenOnPhoneIntent(
    val route: String,
)

@Serializable
data class MarkReadIntent(
    val id: String,
)

@Serializable
data class WatchStateIntent(
    val appVersion: String,
)
