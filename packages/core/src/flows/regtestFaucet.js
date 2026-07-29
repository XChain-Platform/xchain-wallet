// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regtest BTC faucet (Developer Mode convenience). `xchain-regtest-miner`
// exposes an unauthenticated (unless MINER_API_KEY is set) JSON-RPC
// `send_funds` method purpose-built for this: it calls the coin node's
// own `sendtoaddress`, so the funds come from the miner's wallet, not
// from any XChain protocol action. CORS is open on the miner by default
// (local regtest stacks), so this flow calls it directly with `fetch` -
// no signing, no host-side privilege, nothing to route through
// createBackgroundHost.
//
// XCHAIN (or any other XChain-protocol token) is NOT fundable this way:
// the miner only knows about native-coin sendtoaddress, never XChain
// actions. Minting XCHAIN is a real, signed `MINT` action and reuses the
// existing MintForm flow instead (see DeveloperModeSection.jsx).

/**
 * @typedef {Object} RegtestFundResult
 * @property {boolean} ok
 * @property {string} [txid]
 * @property {string} [error]
 */

/**
 * @param {object} opts
 * @param {string} opts.minerUrl    Base URL of the xchain-regtest-miner API (e.g. http://localhost:3005)
 * @param {string} opts.address     Address to fund
 * @param {number} opts.amount      Amount in the chain's native coin units (e.g. BTC, not sats)
 * @param {string} [opts.apiKey]    Sent as X-API-Key when the miner has MINER_API_KEY set
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<RegtestFundResult>}
 */
export async function fundBtcFromMiner({ minerUrl, address, amount, apiKey, fetch: fetchImpl }) {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') {
        return { ok: false, error: 'fetch is not available in this environment' };
    }
    if (!minerUrl || typeof minerUrl !== 'string') {
        return { ok: false, error: 'Miner URL is required' };
    }
    if (!address || typeof address !== 'string') {
        return { ok: false, error: 'Address is required' };
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return { ok: false, error: 'Amount must be a positive number' };
    }

    let resp;
    try {
        resp = await doFetch(minerUrl.replace(/\/+$/, '') + '/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'X-API-Key': apiKey } : {}),
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'send_funds',
                params: { address, amount: amountNum },
            }),
        });
    } catch (err) {
        return { ok: false, error: `Could not reach the regtest miner at ${minerUrl}: ${err?.message || err}` };
    }
    if (!resp.ok) {
        return { ok: false, error: `Miner returned HTTP ${resp.status}` };
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        return { ok: false, error: `Miner returned a non-JSON response: ${err?.message || err}` };
    }
    if (body?.error) {
        const msg = typeof body.error === 'string' ? body.error : (body.error?.message || JSON.stringify(body.error));
        return { ok: false, error: msg };
    }
    // send_funds resolves to the raw txid string (or an {error} object,
    // handled above) - see xchain-regtest-miner/src/api.js.
    const result = body?.result;
    if (result && typeof result === 'object' && result.error) {
        return { ok: false, error: result.error };
    }
    if (typeof result !== 'string' || result.length === 0) {
        return { ok: false, error: 'Miner did not return a transaction id' };
    }
    return { ok: true, txid: result };
}
