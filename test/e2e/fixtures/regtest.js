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
// `playwright.config.js` drives the Vite DEV server, which runs the
// dev-mock SDK - whose signing path throws by design. So no spec run
// that way can ever exercise signing or broadcast, on any chain. That,
// not "missing regtest wiring", is why §8.6's signing legs went unrun
// for months.
//
// : the dev server runs the mock because it is TOLD to
// (`VITE_XCHAIN_REAL_SDK=0`, pinned in `playwright.config.js`), not
// because the real SDK fails to load there. It used to be the latter -
// vite dev threw `require is not defined` on the CJS import and
// `resolveSdkFactory` caught it - and when vite learned to pre-bundle
// the SDK that venue silently became a real-SDK-against-mainnet venue,
// where every compose fails "unreachable". Same venue as before, chosen
// on purpose now.
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
import { openSettings, gotoSection, unlockedShell } from './wallet.js';

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
 * Waits for the chain's own verdict on the action carried by `txid`, and
 * asserts it is `valid`.
 *
 * The counterpart of `assertNoActionRecorded`, and the independent half of
 * any token-action assertion: "Broadcast pending" is the wallet reporting on
 * itself, and even a confirmed transaction says nothing about whether the
 * indexer ACCEPTED the action inside it. An action the handler rejects is
 * recorded with a non-`valid` status and the money simply does not move - a
 * spec that stopped at the txid would pass on that.
 *
 * Mines while it waits: the indexer only records an action once its block
 * lands, and the regtest miner's own timer is too slow to wait out.
 *
 * The default budget is deliberately generous. Mining is instant but INDEXING
 * is not, and on a busy shared venue the indexer can run minutes behind the
 * chain tip - at which point "no action recorded" means "not indexed yet", not
 * "the wallet sent something wrong". A 120s budget failed exactly that way
 * while the action in question was sitting on chain, so the timeout message
 * now reports the lag rather than leaving the next reader to guess.
 */
export async function waitForValidAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await minerRpc('generate_blocks', { count: 1 });
        // limit=100 because that is the explorer's REAL page cap: it silently
        // clamps anything larger, so asking for 200 bought imaginary headroom.
        // The list is newest-first, so one page is ample for an action just
        // broadcast - the risk here was never page depth, it was lag.
        const list = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/actions?limit=100`, {
            signal: AbortSignal.timeout(15_000),
        }).then((r) => r.json()).catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) {
            const detail = await fetch(
                `${EXPLORER_URL}/${REGTEST_COIN}/api/action/${row.action_index}`,
                { signal: AbortSignal.timeout(15_000) },
            ).then((r) => r.json());
            // Assert on the status rather than merely on presence: `invalid:
            // insufficient funds` is also "an action was recorded".
            for (const status of actionStatuses(detail)) {
                expect(status, `chain rejected the action for ${txid}`).toBe('valid');
            }
            return detail;
        }
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
        signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()).catch(() => null);
    throw new Error(
        `No XChain action recorded for ${txid} within ${Math.round(timeoutMs / 1000)}s. `
        + `Chain tip ${status?.chain_tip?.[REGTEST_COIN]}, indexer lag `
        + `${status?.chain_lag_blocks?.[REGTEST_COIN]}, decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}. A non-zero lag means the `
        + `venue is behind, not that the wallet sent something wrong.`,
    );
}

/**
 * Every status an action detail exposes, across both shapes the explorer
 * uses.
 *
 * Single-leg actions (DISPENSER, ISSUE, ...) carry one top-level `status`.
 * A SEND does not: its verdict lives per transfer leg in `sends[]`, because
 * one action can move several ticks and the handler judges each. Asking only
 * for `detail.status` on a SEND reads `undefined`, which is why this throws
 * on finding nothing rather than returning an empty list - a caller looping
 * over zero statuses asserts nothing and passes.
 */
function actionStatuses(detail) {
    const statuses = [];
    if (typeof detail.status === 'string') statuses.push(detail.status);
    for (const leg of Array.isArray(detail.sends) ? detail.sends : []) {
        if (typeof leg.status === 'string') statuses.push(leg.status);
    }
    if (statuses.length === 0) {
        throw new Error(
            `action ${detail.action_index} (${detail.action}) exposed no status; `
            + `keys: ${Object.keys(detail).join(',')}`,
        );
    }
    return statuses;
}

/**
 * Mints `amount` XCHAIN to the active address and waits for the balance.
 *
 * XCHAIN is free-mintable on regtest and testnet by any address, so this is
 * how a freshly-created wallet gets a TOKEN balance - which several §8.6
 * scenarios need, because the parts of the confirm system that only apply to
 * XChain actions (pre-flight, the §4.7 reservation) are exactly the parts a
 * native-coin send skips.
 *
 * Driven through the command palette's Advanced action -> MINT rather than
 * the friendly Mint form, which is balance-scoped and will not offer a tick
 * the wallet holds none of.
 */
export async function mintXchain(page, amount) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox').first();
    await expect(combobox).toBeVisible();
    await combobox.fill('Advanced action');
    await page.keyboard.press('Enter');

    await page.getByLabel('Action').selectOption('MINT');
    await page.getByRole('textbox', { name: 'TICK', exact: true }).fill('XCHAIN');
    await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(amount));
    await page.getByRole('button', { name: 'Sign action' }).click();

    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    // The advanced-action flow has its own terminal screen; rather than
    // couple to it, wait on the thing that actually matters downstream - the
    // on-chain balance, below.
    await page.waitForTimeout(4_000);
}

/**
 * The XCHAIN balance `address` holds right now, as a number (0 when the
 * explorer carries no row for it at all).
 *
 * A plain read with no waiting and no mining, which is what a BEFORE/AFTER
 * assertion needs: the interesting question for a multi-leg send is not "did
 * the balance reach N" but "did it move by exactly the leg amount", and a
 * helper that waits for a threshold cannot answer that.
 *
 * @param {string} address
 * @param {string} tick
 * @returns {Promise<number>}
 */
export async function tokenBalance(address, tick) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances/${address}`, {
        signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const row = (body?.data || []).find((b) => b.tick === tick);
    return row ? Number(row.amount) : 0;
}

/**
 * Mines one block, but ONLY while the decode/index pipeline is keeping up.
 *
 * Promoted from the BET round-trip spec, which found the hazard the hard way:
 * a poll loop that mines unconditionally outruns the decoder, so the state it
 * is waiting for never indexes and the loop responds by mining harder. One run
 * left the decoder 157 blocks behind the node with every balance read empty,
 * which presents as "the wallet's action vanished" and is really the harness
 * flooding the venue. Blocks are only ever needed to ADVANCE state, never to
 * make an already-mined action visible, so skipping the mine while the pipeline
 * catches up costs nothing.
 *
 * Never throws: a poll loop must keep polling when the status read blips.
 */
export async function nudgeChain() {
    try {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, {
            signal: AbortSignal.timeout(10_000),
        });
        const status = await res.json();
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* the venue check in global setup reports real unreachability */ }
}

/**
 * Polls the explorer until `address` holds at least `min` of `tick`.
 *
 * Mines on each pass for the same reason `fundAddress` does: the wallet and
 * the indexer both only see confirmed state, and waiting on the miner's own
 * timer turns every balance-dependent spec into an intermittent failure that
 * reads like a wallet bug.
 */
export async function waitForTokenBalance(address, tick, min, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances/${address}`, {
                signal: AbortSignal.timeout(15_000),
            });
            const body = await res.json();
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? row.amount : null;
            if (row && Number(row.amount) >= min) return row;
        } catch { /* transient while a block lands */ }
        await minerRpc('generate_blocks', { count: 1 });
        await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
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
    // One UI walk for every shell. `openSettings` absorbs the only difference:
    // web/desktop navigate, the MV3 popup goes through the command palette
    // because it has no nav surface .
    await openSettings(page);

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

    // Wait for whichever side of the fork this shell lands on. The extension
    // keeps its session master key in `chrome.storage.session`, which SURVIVES
    // a popup reload, so it comes back already unlocked; the web shell holds
    // it in memory and re-locks. Waiting only for the unlock screen hangs for
    // 60s in the extension on a wallet that is fine.
    await unlock.or(unlockedShell(page)).first()
        .waitFor({ state: 'visible', timeout: 60_000 });

    if (await unlock.count() === 0) return;

    await page.getByLabel('Password').fill(password);
    await unlock.click();
    // Home's balance hero, not the Lock button: the popup renders no nav at
    // all, and below 600px Lock sits inside the closed More sheet.
    await expect(unlockedShell(page)).toBeVisible({ timeout: 90_000 });
}

/**
 * Reads the wallet's own regtest receive address off the Receive screen.
 *
 * This is the only way to learn it: addresses derive from a random seed
 * at wallet creation, so the spec cannot know it in advance.
 */
export async function readReceiveAddress(page) {
    await gotoSection(page, 'Receive');

    const field = page.getByLabel('Address', { exact: true });
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue(/^bcrt1/, { timeout: 30_000 });
    return field.inputValue();
}
