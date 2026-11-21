// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One search and sort vocabulary for every Home tab. Each matcher reads only
// the text its row shows (a name, a ticker, an action, a counterparty), so a
// query never keeps a row whose visible text does not contain it.

import { actionDisplayLabel } from './actionDisplayLabel.js';
import { classifyEntryAction } from './historyFilter.js';
import { activityRowTick } from './activityAmount.js';
import { compareMergedEntries } from './pendingHistory.js';

/** Lower-cases and trims the Home search box value; '' means no query. */
export function normalizeHomeQuery(query) {
    return String(query || '').trim().toLowerCase();
}

function anyFieldContains(fields, q) {
    if (!q) return true;
    return fields.some((field) => field != null && String(field).toLowerCase().includes(q));
}

/** Coins, Tokens and NFTs rows: the name and the ticker the row shows. */
export function balanceRowMatchesQuery(row, q) {
    return anyFieldContains([row?.displayName, row?.tick, row?.coin], q);
}

export function filterBalanceRowsByQuery(rows, q) {
    const list = Array.isArray(rows) ? rows : [];
    return q ? list.filter((row) => balanceRowMatchesQuery(row, q)) : list;
}

// A stake is always the protocol token, matching how the DeFi row draws it.
function defiPositionTick(position) {
    return position?.action === 'STAKE' ? 'XCHAIN' : String(position?.tick || '');
}

/** The DeFi row's visible name: its action label, then its token. */
export function defiPositionName(position) {
    return [actionDisplayLabel(position?.action) || position?.action || '', defiPositionTick(position)]
        .filter(Boolean)
        .join(' ');
}

export function defiPositionMatchesQuery(position, q) {
    return anyFieldContains([
        defiPositionName(position),
        position?.title,
        position?.action,
        defiPositionTick(position),
    ], q);
}

function defiPositionFiatValue(position) {
    const value = position?.fiatValue;
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function compareDefiNames(a, b) {
    const byName = defiPositionName(a).localeCompare(defiPositionName(b), undefined, { sensitivity: 'base' });
    return byName || compareMergedEntries(a, b);
}

/**
 * Orders DeFi positions by the Home sort control. Value puts priced rows
 * first, largest first; rows without a value follow, by name.
 */
export function sortDefiPositions(positions, sortBy) {
    const list = Array.isArray(positions) ? positions.slice() : [];
    if (sortBy !== 'value') return list.sort(compareDefiNames);
    return list.sort((a, b) => {
        const aValue = defiPositionFiatValue(a);
        const bValue = defiPositionFiatValue(b);
        if ((aValue === null) !== (bValue === null)) return aValue === null ? 1 : -1;
        if (aValue !== null && aValue !== bValue) return bValue - aValue;
        return compareDefiNames(a, b);
    });
}

/** The action label an Activity row shows for its entry. */
export function activityEntryLabel(entry, walletAddresses) {
    const kind = classifyEntryAction(entry, walletAddresses);
    // Lifecycle buckets group related rows, but each row keeps its exact verb.
    const exactAction = kind === 'other' || kind === 'order' || kind === 'swap';
    return actionDisplayLabel(exactAction ? entry.action : kind)
        || actionDisplayLabel(entry.action)
        || 'Event';
}

const COUNTERPARTY_KEYS = [
    'source', 'SOURCE', 'destination', 'DESTINATION', 'recipient', 'RECIPIENT',
    'tx0_address', 'TX0_ADDRESS', 'tx1_address', 'TX1_ADDRESS',
    'give_address', 'GIVE_ADDRESS', 'get_address', 'GET_ADDRESS',
];

/** Activity rows: the action, the token and the counterparty addresses. */
export function activityEntryMatchesQuery(entry, q, walletAddresses = new Set()) {
    if (!q) return true;
    if (!entry) return false;
    const raw = entry.raw || {};
    return anyFieldContains([
        activityEntryLabel(entry, walletAddresses),
        entry.action,
        activityRowTick(entry),
        entry.source,
        ...COUNTERPARTY_KEYS.map((key) => raw[key]),
    ], q);
}
