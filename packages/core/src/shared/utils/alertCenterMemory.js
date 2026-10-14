// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const NS = 'xc:alertCenter:';

export function alertVersion(alert) {
    return JSON.stringify([alert.id, alert.title, alert.message]);
}

export function readAlertCenter(walletId) {
    if (!walletId) return { read: new Set(), cleared: new Set() };
    try {
        const record = JSON.parse(globalThis.localStorage?.getItem(NS + walletId) || 'null');
        return {
            read: new Set(Array.isArray(record?.read) ? record.read.filter((key) => typeof key === 'string') : []),
            cleared: new Set(Array.isArray(record?.cleared) ? record.cleared.filter((key) => typeof key === 'string') : []),
        };
    } catch (_err) {
        return { read: new Set(), cleared: new Set() };
    }
}

export function writeAlertCenter(walletId, state) {
    if (!walletId) return;
    try {
        globalThis.localStorage?.setItem(NS + walletId, JSON.stringify({
            read: [...state.read],
            cleared: [...state.cleared],
        }));
    } catch (_err) {
        // Browser privacy modes can refuse storage while the in-memory center remains usable.
    }
}
