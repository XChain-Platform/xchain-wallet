// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regtest venue helpers: the seam between a Playwright spec and a real
// chain (, spec §8.6).
//
// WHY THESE SPECS ARE SEPARATE FROM THE REST OF THE SUITE
//
// `playwright.config.js` drives the Vite DEV server, and the dev server
// CANNOT load the real SDK in a browser: xchain-sdk is CommonJS, vite
// dev throws `require is not defined` on the dynamic import, and
// `resolveSdkFactory` then falls back to the dev mock - whose signing
// path throws by design. So no spec run that way can ever exercise
// signing or broadcast, on any chain. That, not "missing regtest
// wiring", is why §8.6's signing legs went unrun for months.
//
// `playwright.regtest.config.js` serves a `vite preview` of the
// PRODUCTION build instead, which rollup bundles the CJS into - the
// same artifact users get. Production builds delete the dev mock
// entirely and THROW rather than fall back (hostBridge.js `sdkResolved`
// under `import.meta.env.PROD`), so a preview that renders at all is
// itself proof the real SDK loaded. There is no mock to accidentally
// test against here.
//
// VENUE CONTRACT
//
// These specs need the devhost 3-chain regtest stack reachable on
// localhost at the ports the wallet's `bitcoin-regtest` descriptor
// already names (explorer 18080, encoder 3023, hub 10000) plus the
// regtest-miner on 3025 for funding. SSH tunnels satisfy that with no
// code change:
//
//   ssh -N -L 18080:localhost:18080 -L 3023:localhost:3023 \
//          -L 10000:localhost:10000 -L 3025:localhost:3025 jdog@devhost
//
// `assertVenueReachable()` (called from global setup) fails once, fast,
// with that command in the message, rather than letting every spec die
// several screens deep in the UI on a symptom that looks like a wallet
// bug.

import { expect } from '@playwright/test';

/** Explorer/encoder/hub ports come from the `bitcoin-regtest` descriptor. */
export const EXPLORER_URL = 'http://localhost:18080';
export const ENCODER_URL = 'http://localhost:3023';
export const MINER_URL = 'http://localhost:3025';

/** Explorer coin code for the regtest Bitcoin chain. */
export const REGTEST_COIN = 'RBTC';

/**
 * A deterministic, checksum-valid regtest P2WPKH destination.
 *
 * Derived once from a fixed sha256 (`bitcoinjs-lib` p2wpkh over
 * hash160('xchain-wallet-e2e-regtest-destination')) and pinned as a
 * literal so specs assert on a stable string. Nothing holds its key:
 * anything sent here is intentionally unspendable-by-us, which is what
 * a throwaway e2e destination should be.
 */
export const REGTEST_DESTINATION = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';

/** JSON-RPC 2.0 call against a venue service. Throws on RPC-level errors. */
async function venueRpc(url, method, params = {}, timeoutMs = 30_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: controller.signal,
        });
        const body = await res.json();
        if (body.error) {
            throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
        }
        // The miner reports some failures as a `result.error` string rather
        // than a JSON-RPC error object; treat that as a failure too, or a
        // bad fund silently becomes "waiting for a UTXO that never comes".
        if (body.result && typeof body.result === 'object' && body.result.error) {
            throw new Error(`${method} failed: ${body.result.error}`);
        }
        return body.result;
    } finally {
        clearTimeout(timer);
    }
}

export const minerRpc = (method, params) => venueRpc(MINER_URL, method, params);
export const encoderRpc = (method, params) => venueRpc(ENCODER_URL, method, params);

/**
 * Fails the run early, with the fix, when the venue is not reachable.
 *
 * Called from global setup so a down tunnel costs one legible error
 * instead of N specs timing out inside the wallet UI.
 */
export async function assertVenueReachable() {
    const hint =
        'Regtest venue unreachable. Open the tunnels:\n'
        + '  ssh -N -L 18080:localhost:18080 -L 3023:localhost:3023 '
        + '-L 10000:localhost:10000 -L 3025:localhost:3025 jdog@devhost';

    let status;
    try {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
            signal: AbortSignal.timeout(10_000),
        });
        status = await res.json();
    } catch (err) {
        throw new Error(`${hint}\n\nExplorer ${EXPLORER_URL} did not answer: ${err.message}`);
    }

    // A reachable-but-lagging chain produces confusing spec failures
    // (funds that never arrive), so check liveness, not just liveness of
    // the socket.
    const lag = status?.chain_lag_blocks?.[REGTEST_COIN];
    if (typeof lag !== 'number') {
        throw new Error(`${hint}\n\nExplorer answered but reports no ${REGTEST_COIN} chain.`);
    }
    if (lag > 2) {
        throw new Error(`Regtest ${REGTEST_COIN} indexer is ${lag} blocks behind; wait for it to catch up.`);
    }

    let miner;
    try {
        miner = await minerRpc('status', {}, 10_000);
    } catch (err) {
        throw new Error(`${hint}\n\nRegtest miner ${MINER_URL} did not answer: ${err.message}`);
    }
    if (!miner?.wallet_ready) {
        throw new Error(`Regtest miner is up but its wallet is not ready: ${JSON.stringify(miner)}`);
    }
}

/**
 * Funds `address` with `amountBtc` and waits until the encoder's
 * utxo-tracker view actually shows it.
 *
 * Mines a block explicitly rather than trusting the miner's timer: the
 * wallet selects only CONFIRMED utxos, so a spec that raced the next
 * scheduled block would fail intermittently on "no funds" - the worst
 * kind of e2e flake, because it looks like a wallet bug.
 */
export async function fundAddress(address, amountBtc = 1) {
    const before = await countUtxos(address);
    await minerRpc('send_funds', { address, amount: amountBtc });
    await minerRpc('generate_blocks', { count: 1 });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if ((await countUtxos(address)) > before) return;
        await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`Funding ${address} with ${amountBtc} BTC never appeared in the utxo-tracker view`);
}

async function countUtxos(address) {
    const result = await encoderRpc('get_utxos', { address });
    return Array.isArray(result?.utxos) ? result.utxos.length : 0;
}

/**
 * Mines a block and waits for `txid` to show up as a confirmed UTXO on
 * `address`, returning it.
 *
 * This is the independent half of a broadcast assertion. "Broadcast
 * pending" is the wallet reporting on itself; this is the CHAIN
 * reporting that the money arrived, at the right address, for the right
 * amount, from the transaction the wallet claimed to have sent. A
 * signed-but-wrong transaction (bad output set, wrong amount) passes
 * the first check and fails this one.
 */
export async function waitForConfirmedUtxo(address, txid, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    await minerRpc('generate_blocks', { count: 1 });

    while (Date.now() < deadline) {
        const result = await encoderRpc('get_utxos', { address });
        const match = (result?.utxos || []).find((u) => u.txid === txid || u.fullTxid === txid);
        if (match) return match;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Transaction ${txid} never confirmed to ${address}`);
}

/**
 * Makes the next broadcast fail, with a chosen node reject reason.
 *
 * §8.6 scenarios 3 and 4 hinge on the wallet CLASSIFYING a post-sign
 * broadcast failure correctly: a transient one keeps the signed
 * transaction recoverable and queued, a permanent one marks it failed and
 * demands a re-compose. Getting a real node to produce each reason on
 * demand is not something a test can do reliably - a doomed transaction
 * needs its inputs spent out from under it by someone else - so the
 * reject string is injected at the encoder's `broadcast_tx` boundary
 * instead.
 *
 * What is simulated is only the node's ANSWER. Everything before it is
 * real: a real compose, a real tamper check, a real signature over the
 * real PSBT, and the wallet's real classification path. The strings used
 * are the node's own (`bad-txns-inputs-missingorspent`, ECONNREFUSED).
 *
 * Only `broadcast_tx` is intercepted - `create_tx` and `get_utxos` share
 * this endpoint and must keep working, or the send would never get far
 * enough to broadcast at all.
 */
export async function failBroadcast(page, kind) {
    const reason = kind === 'permanent'
        ? 'bad-txns-inputs-missingorspent'
        : 'connect ECONNREFUSED 127.0.0.1:3023';

    await page.route(`${ENCODER_URL}/**`, async (route) => {
        const body = route.request().postData() || '';
        if (!body.includes('"broadcast_tx"')) return route.continue();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32010, message: reason, data: { reason } },
            }),
        });
    });
}

/**
 * Asserts the chain recorded NO XChain action for `txid`.
 *
 * : a plain native-coin payment must be an ordinary payment. It used
 * to carry a `SEND|0|BTC|...` OP_RETURN that the indexer could only ever
 * record as `invalid: TICK (unknown)`, so "did an action get written?" is
 * the question that actually distinguishes the fix from the bug - a
 * spec that only checked the money arrived passed happily either way.
 */
export async function assertNoActionRecorded(txid) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/actions?limit=200`, {
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    // An empty list would make this assertion vacuous - it would "pass" on a
    // dead explorer just as readily as on a correct payment.
    expect(rows.length, 'explorer returned no actions at all; cannot conclude anything').toBeGreaterThan(0);
    const match = rows.find((r) => r.tx_hash === txid);
    expect(match, `an XChain action was recorded for a plain payment: ${JSON.stringify(match)}`)
        .toBeUndefined();
}

/**
 * Flips the wallet onto the regtest network and waits for it to come
 * back up.
 *
 * Two venue facts are baked in here because both cost a debugging
 * session to find:
 *   - Regtest chains are HIDDEN until Developer Mode is on
 *     (NetworkSection deliberately filters the option), so dev mode has
 *     to be enabled first.
 *   - The network control is an inline `kind: 'panel'` section on the
 *     Settings index (a `<select aria-label="Active network">`), NOT a
 *     drill row like Developer Mode.
 *
 * The switch reloads the page (NetworkSection does this on purpose so
 * chain-scoped effects re-derive), and a reload re-locks the vault, so
 * this unlocks again before returning.
 */
export async function switchToRegtest(page, password) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    await page.getByRole('button', { name: /^Developer Mode/ }).click();
    const devToggle = page.getByRole('switch', { name: 'Developer Mode', exact: true });
    await expect(devToggle).toBeVisible();
    if (!(await devToggle.isChecked())) {
        // `.check()` fails here: the input is fully controlled by PERSISTED
        // settings, so its `checked` does not flip until the vault write
        // resolves, and check()'s post-click assertion is synchronous.
        // Click, then wait for the state the write produces.
        await devToggle.click();
        await expect(devToggle).toBeChecked();
    }
    await page.getByRole('button', { name: 'Back to settings' }).click();

    // : this select now derives an address on each chain of the
    // network it switches to. Before that fix it only moved a filter,
    // stranding the wallet with no addresses and no UI path to make one -
    // so if this ever regresses, the funding step below is where it shows.
    await page.getByLabel('Active network').selectOption('regtest');

    await unlockAfterReload(page, password);
}

/**
 * Waits out the post-switch reload and unlocks.
 *
 * Kept separate because every `goto`/reload in a regtest spec needs it:
 * the vault does not survive a page load.
 */
export async function unlockAfterReload(page, password) {
    const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
    await expect(unlock).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Password').fill(password);
    await unlock.click();
    await expect(page.getByRole('button', { name: 'Lock', exact: true }))
        .toBeVisible({ timeout: 90_000 });
}

/**
 * Reads the wallet's own regtest receive address off the Receive screen.
 *
 * This is the only way to learn it: addresses derive from a random seed
 * at wallet creation, so the spec cannot know it in advance.
 */
export async function readReceiveAddress(page) {
    await page.getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('button', { name: 'Receive', exact: true })
        .click();

    const field = page.getByLabel('Address', { exact: true });
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue(/^bcrt1/, { timeout: 30_000 });
    return field.inputValue();
}
