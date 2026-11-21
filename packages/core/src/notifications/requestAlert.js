// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function composeRequestAlert(request, { labels, now = Date.now }) {
    const { id, kind, sentence, amountText, expiresAt } = request || {};
    if (kind !== 'request' && kind !== 'paydue') return null;
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    if (typeof sentence !== 'string' || sentence.length === 0) return null;

    const title = labels?.[kind];
    if (typeof title !== 'string' || title.length === 0) return null;

    if (expiresAt !== undefined
        && (!Number.isFinite(expiresAt) || expiresAt <= now())) return null;

    const data = { requestId: id };
    if (Number.isFinite(expiresAt)) data.expiresAt = expiresAt;

    return {
        kind,
        title,
        body: typeof amountText === 'string' && amountText.length > 0
            ? `${sentence}\n${amountText}`
            : sentence,
        data,
    };
}
