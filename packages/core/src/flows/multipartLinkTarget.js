// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function unwrap(value) {
    let row = value?.data ?? value;
    if (Array.isArray(row)) row = row[0];
    if (row?.action && typeof row.action === 'object') row = row.action;
    return row && typeof row === 'object' ? row : null;
}

function transactionVerdict(value) {
    const transaction = unwrap(value);
    const actions = Array.isArray(transaction?.actions) ? transaction.actions : [];
    if (actions.length === 0) return { reason: 'not_indexed' };
    const manifest = actions.find((row) => String(row?.action || '').toUpperCase() === 'FILE');
    if (!manifest) return { reason: 'not_a_manifest' };
    const actionIndex = manifest.action_index ?? manifest.actionIndex;
    if (actionIndex === null || actionIndex === undefined || String(actionIndex) === '') {
        return { reason: 'not_indexed' };
    }
    return { actionIndex: String(actionIndex) };
}

function actionVerdict(value, actionIndex) {
    const action = unwrap(value);
    const kind = String(action?.action || '').toUpperCase();
    const validity = String(action?.status || '').toLowerCase();
    if (kind !== 'FILE' || validity !== 'valid' || Number(action?.action_format) !== 1) {
        return { ready: false, reason: 'not_a_manifest' };
    }
    if (action.multipart === null || action.multipart === undefined) {
        return { ready: false, reason: 'not_a_manifest' };
    }
    if (typeof action.multipart !== 'object' || Array.isArray(action.multipart)) {
        return { ready: false, reason: 'unreadable' };
    }
    const status = String(action.multipart.status).toLowerCase();
    if (status === 'complete') return { ready: true, actionIndex };
    if (status === 'pending' || status === 'mismatch') return { ready: false, reason: status };
    return { ready: false, reason: 'unreadable' };
}

async function readAttempt(explorer, txid) {
    const transaction = await explorer.getTransaction(String(txid), 'tx_hash');
    const target = transactionVerdict(transaction);
    if (!target.actionIndex) return { ready: false, reason: target.reason };
    const detail = await explorer.getAction(target.actionIndex);
    return actionVerdict(detail, target.actionIndex);
}

export async function resolveMultipartLinkTarget({
    explorer,
    txid,
    coin,
    maxAttempts = 1,
    waitMs = 0,
    sleep = async () => {},
}) {
    void coin;
    const attempts = Math.max(1, Math.trunc(Number(maxAttempts)) || 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        let result;
        try {
            result = await readAttempt(explorer, txid);
        } catch {
            return { ready: false, reason: 'unreadable' };
        }
        const retryable = result.reason === 'pending' || result.reason === 'not_indexed';
        if (!retryable || attempt === attempts - 1) return result;
        try {
            await sleep(waitMs);
        } catch {
            return { ready: false, reason: 'unreadable' };
        }
    }
    return { ready: false, reason: 'unreadable' };
}
