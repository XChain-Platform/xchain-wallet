// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui

import io.xchain.wallet.android.wear.data.Request
import io.xchain.wallet.android.wear.data.SnapshotInboxItem
import kotlinx.serialization.Serializable

data class AlertDisplay(
    val id: String,
    val family: String,
    val title: String,
    val body: String?,
    val at: Long,
    val unread: Boolean,
)

@Serializable
data class AlertDisplayValue(
    val key: String? = null,
    val text: String? = null,
    val at: Long? = null,
)

@Serializable
data class AlertDetailLine(
    val label: AlertDisplayValue?,
    val value: AlertDisplayValue,
)

@Serializable
data class RequestDisplay(
    val pinned: AlertDisplayValue,
    val lines: List<AlertDetailLine>,
)

data class AlertsDisplay(
    val rows: List<AlertDisplay>,
    val emptyTextKey: String?,
    val request: RequestDisplay?,
)

object AlertsPresenter {
    fun present(
        inbox: List<SnapshotInboxItem>,
        request: Request?,
        now: Long,
    ): AlertsDisplay {
        val rows = AlertsRules.newestFirst(inbox) { it.at }.map {
            AlertDisplay(
                id = it.id,
                family = it.family,
                title = it.title,
                body = AlertsRules.detailBody(it.body),
                at = it.at,
                unread = !it.read,
            )
        }
        return AlertsDisplay(
            rows = rows,
            emptyTextKey = AlertsRules.emptyTextKey(rows.size),
            request = request?.let { presentRequest(it, now) },
        )
    }

    fun presentRequest(request: Request, now: Long): RequestDisplay {
        val lines = mutableListOf(
            AlertDetailLine(
                AlertDisplayValue(key = "w4.requestSentence"),
                AlertDisplayValue(text = request.sentence),
            ),
            AlertDetailLine(
                AlertDisplayValue(key = "w4.requestAmount"),
                AlertDisplayValue(text = request.amountText),
            ),
        )
        request.expiresAt?.let { expiresAt ->
            lines += if (AlertsRules.isExpired(expiresAt, now)) {
                AlertDetailLine(null, AlertDisplayValue(key = "w4.requestExpired"))
            } else {
                AlertDetailLine(
                    AlertDisplayValue(key = "w4.requestExpiry"),
                    AlertDisplayValue(at = expiresAt),
                )
            }
        }
        return RequestDisplay(AlertDisplayValue(key = "w1.requestWaiting"), lines)
    }
}
