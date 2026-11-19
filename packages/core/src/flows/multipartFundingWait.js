// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { legChainStatus } from './deployLegWait.js';

export const FILE_FUNDING_NOT_CONFIRMED = 'FILE_FUNDING_NOT_CONFIRMED';

const INVALID_WAIT = 'FILE_FUNDING_WAIT_INVALID';

function invalidWaitError(field) {
    const err = new Error(`Invalid funding confirmation wait field: ${field}`);
    err.code = INVALID_WAIT;
    return err;
}

function validateWait({ txid, timeoutMs, pollMs, sleep, now, dropGraceMs }) {
    if (!/^[0-9a-fA-F]{64}$/.test(String(txid || ''))) throw invalidWaitError('txid');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw invalidWaitError('timeoutMs');
    if (!Number.isFinite(pollMs) || pollMs <= 0) throw invalidWaitError('pollMs');
    if (typeof sleep !== 'function') throw invalidWaitError('sleep');
    if (typeof now !== 'function') throw invalidWaitError('now');
    if (!Number.isFinite(dropGraceMs) || dropGraceMs < 0) throw invalidWaitError('dropGraceMs');
}

function notConfirmedError({ chainState, txid }) {
    const message = `The upload is saved, but funding transaction ${txid} is not confirmed. Do not pay again.`;
    const err = new Error(message);
    err.name = 'FileFundingNotConfirmedError';
    err.code = FILE_FUNDING_NOT_CONFIRMED;
    err.chainState = chainState;
    err.txid = txid;
    return err;
}

export function fundingMayBeOnChain(err) {
    return Boolean(err && err.code === FILE_FUNDING_NOT_CONFIRMED && err.chainState !== 'dropped');
}

export async function waitForFundingConfirmed({
    sdk, txid, address, timeoutMs, pollMs, sleep, now, onWait, dropGraceMs = 0,
}) {
    validateWait({ txid, timeoutMs, pollMs, sleep, now, dropGraceMs });
    const startedAt = now();
    let droppedReadings = 0;
    for (;;) {
        const status = await legChainStatus({ sdk, txid, address });
        const chainState = status === null ? 'unknown' : status;
        if (status === 'confirmed') return { txid, chainState: 'confirmed' };
        if (status === null) throw notConfirmedError({ chainState, txid });
        const waitedMs = now() - startedAt;
        const settled = waitedMs >= dropGraceMs;
        droppedReadings = status === 'dropped' && settled ? droppedReadings + 1 : 0;
        if (droppedReadings >= 2 || waitedMs >= timeoutMs) {
            throw notConfirmedError({ chainState, txid });
        }
        if (typeof onWait === 'function') {
            try { onWait({ chainState, waitedMs }); } catch {}
        }
        await sleep(pollMs);
    }
}
