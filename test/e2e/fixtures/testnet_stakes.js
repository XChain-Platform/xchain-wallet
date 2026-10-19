// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const REQUEST_TIMEOUT_MS = 30_000;

function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function failureDetail(error) {
    if (Number.isInteger(error?.httpStatus)) return `HTTP ${error.httpStatus}`;

    const code = typeof error?.cause?.code === 'string'
        ? error.cause.code
        : typeof error?.code === 'string'
            ? error.code
            : error?.name;
    return typeof code === 'string' && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown';
}

async function explorerRows(address, { explorerUrl, coin, fetch }) {
    const response = await fetch(`${explorerUrl}/${coin}/api/stakes/${address}/source`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw Object.assign(new Error(), { httpStatus: response.status });
    }
    const body = await response.json();
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.rows)) return body.rows;
    throw Object.assign(new Error(), { code: 'NO_STAKE_LIST' });
}

export async function waitForResidualStake(address, actionIndex, {
    explorerUrl,
    coin,
    timeoutMs,
    pollMs = 30_000,
    fetch = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
}) {
    const deadline = now() + timeoutMs;
    let lastFailure = null;

    while (now() < deadline) {
        try {
            const rows = await explorerRows(address, { explorerUrl, coin, fetch });
            lastFailure = null;
            const row = rows.find((item) => Number(item.action_index) === Number(actionIndex));
            if (row) return row;
        } catch (error) {
            lastFailure = error;
        }

        if (now() < deadline) await sleep(pollMs);
    }

    const detail = lastFailure ? `; last explorer failure: ${failureDetail(lastFailure)}` : '';
    throw new Error(`residual stake for action ${actionIndex} was not indexed${detail}`);
}
