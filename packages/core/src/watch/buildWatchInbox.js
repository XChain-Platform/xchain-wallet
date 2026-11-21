// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { getDefaultAlertInbox } from '../shared/alertInbox.js';
import { isValidAddressAnyNetwork } from '../shared/utils/addressValidation.js';
import kinds from './contract/kinds.json' with { type: 'json' };

const ADDRESS_REPLACEMENT = 'an address';

function watchText(text, maxLength) {
    const codePoints = [...redactAddresses(text, ADDRESS_REPLACEMENT).trim()];
    if (codePoints.length <= maxLength) return codePoints.join('');

    const prefix = codePoints.slice(0, maxLength - 1);
    let whitespaceIndex = -1;
    for (let i = prefix.length - 1; i >= 0; i -= 1) {
        if (/\s/u.test(prefix[i])) {
            whitespaceIndex = i;
            break;
        }
    }
    const cut = whitespaceIndex === -1 ? prefix : prefix.slice(0, whitespaceIndex);
    return `${cut.join('').trimEnd()}…`;
}

export function watchInboxKind(alertId, kinds) {
    if (typeof alertId !== 'string') return null;

    const match = alertId.match(/^notification:([^:]+):/);
    if (!match) return null;

    const kind = match[1];
    const family = Object.keys(kinds).find((key) => kinds[key].kinds.includes(kind));
    return family ? { kind, family } : null;
}

export function redactAddresses(text, replacement) {
    const redacted = String(text).replace(/\S+/g, (word) => {
        const leading = word.match(/^[^A-Za-z0-9]*/)[0];
        const trailing = word.match(/[^A-Za-z0-9]*$/)[0];
        const candidate = word.slice(leading.length, word.length - trailing.length);

        return isValidAddressAnyNetwork(candidate)
            ? `${leading}${replacement}${trailing}`
            : word;
    });

    return redacted.replace(/[A-Za-z0-9]{26,}/g, () => replacement);
}

export async function buildWatchInbox() {
    const alerts = await getDefaultAlertInbox().list();
    const rows = [];

    for (const alert of alerts) {
        const classified = watchInboxKind(alert.id, kinds);
        if (!classified) continue;
        rows.push({
            id: alert.id,
            family: classified.family,
            kind: classified.kind,
            title: watchText(alert.title, 60),
            body: watchText(alert.message, 160),
            at: alert.at,
            read: alert.read,
        });
        if (rows.length === 20) break;
    }

    return rows;
}
