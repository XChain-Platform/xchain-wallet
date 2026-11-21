// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function activityCheckTargets(entries) {
    const seen = new Set();
    const targets = [];

    for (const { address, explorerBaseUrl } of entries) {
        const key = JSON.stringify([address, explorerBaseUrl]);
        if (seen.has(key)) continue;
        seen.add(key);

        const baseUrl = explorerBaseUrl.replace(/\/+$/, '');
        targets.push({
            address,
            url: `${baseUrl}/address/${encodeURIComponent(address)}`,
            confirmedPath: 'balances.confirmed',
            pendingPath: 'balances.pending',
        });
    }

    return targets;
}
