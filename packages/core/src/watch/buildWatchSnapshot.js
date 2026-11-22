// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildWatchReceive } from './buildWatchReceive.js';
import { buildWatchRows } from './buildWatchRows.js';
import { buildWatchSettings } from './buildWatchSettings.js';
import { buildWatchTotals } from './buildWatchTotals.js';

export const SNAPSHOT_BUDGET_BYTES = 60 * 1024;

const utf8JsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export function fitSnapshotBudget(snapshot, budgetBytes) {
    const fitted = { ...snapshot, rows: [...snapshot.rows] };

    while (fitted.rows.length > 0 && utf8JsonBytes(fitted) > budgetBytes) {
        fitted.rows.pop();
        fitted.capped = true;
    }

    return fitted;
}

export function buildWatchSnapshot(state = {}, {
    now = state.now ?? 0,
    budgetBytes = SNAPSHOT_BUDGET_BYTES,
    chainRegistry,
} = {}) {
    const settings = buildWatchSettings(state.settings);
    const sourceRows = settings.enabled ? (state.rows ?? []) : [];
    const builtRows = buildWatchRows(sourceRows, state);
    const totals = buildWatchTotals(state.totalRows ?? sourceRows, state);
    const empty = !settings.enabled;
    const snapshot = {
        v: 1,
        builtAt: now,
        balancesAt: state.balancesAt ?? now,
        pricesAt: state.pricesAt ?? now,
        session: totals.session,
        network: totals.network,
        fiatCode: totals.fiatCode,
        hidden: empty ? false : Boolean(state.hidden),
        unitDefault: totals.unitDefault,
        walletName: empty ? '' : totals.walletName,
        totals: empty ? { fiatText: '', unitsText: 'Balances' } : totals.totals,
        rows: builtRows.rows,
        capped: empty ? false : Boolean(state.capped || builtRows.capped),
        receive: empty ? [] : buildWatchReceive(state.activeByChain, chainRegistry),
        inbox: empty ? [] : [...(state.inbox ?? [])],
        request: state.request,
        settings,
    };

    return fitSnapshotBudget(snapshot, budgetBytes);
}
