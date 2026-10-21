// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// gasToken: make sure the venue chain carries the XCHAIN gas token before any
// spec asks to use it.
//
// WHY THIS EXISTS, measured 2026-09-01. The regtest stack was re-genesised
// (every chain restarted from height 0) and the first spec to run afterwards
// died in its setup with the wallet's own sentence on screen: "The network
// would refuse this action as it stands: TICK (unknown)". XCHAIN is not a
// protocol constant in a fresh database. Bitcoin creates its open-mint ISSUE;
// Litecoin and Dogecoin receive their token row only when an XBRIDGE v0 lock
// from Bitcoin is settled there. This is the same supply path used by the
// xchain-e2e-test `gas-token-check` phase.
//
// The parameters below are that phase's, byte for byte, so the two suites
// agree about what XCHAIN is on a fresh chain: no pre-minted supply, minting
// left unlocked and open from genesis, a per-transaction cap high enough that
// `mintXchain(page, 5000)` is never throttled.
//
// Bitcoin is probed with the venue's own MINT fee quote. Off Bitcoin, the
// bridged row is mint-locked by design, so a valid MINT quote cannot be the
// existence test; those chains use the token-detail endpoint instead.

import { chromium, devices, expect } from '@playwright/test';
import {
    EXPLORER_URL, REGTEST_COIN, REGTEST_DESTINATION,
    switchToRegtest, unlockAfterReload, readReceiveAddress,
    expectConfirmModal, approveConfirm, mintXchain,
} from './regtest.js';
import { selectNamedChain } from './crossChain.js';
import {
    createWallet, openPaletteCommand, LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
} from './wallet.js';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { desktopUserAgentForHost } from '../host-user-agent.js';

export const GAS_TICK = 'XCHAIN';

/** The e2e-test suite's faucet issuance, mirrored (initialCheck.test.js gas-token-check). */
export const GAS_ISSUE = Object.freeze({
    MAX_SUPPLY: '100000000',
    MAX_MINT: '100000',
    DECIMALS: '0',
    DESCRIPTION: 'XChain GAS Token',
    MINT_SUPPLY: '0',
});

const BOOTSTRAP_PASSWORD = 'GasBootstrap!2026';
const BTC_COIN = 'RBTC';
const BRIDGE_AMOUNT = 5000;
const RAILS = Object.freeze({
    RBTC: { coin: 'BTC', label: 'Bitcoin', encoderPort: 3023, minerPort: 3025 },
    RLTC: { coin: 'LTC', label: 'Litecoin', encoderPort: 3223, minerPort: 3225 },
    RDOGE: { coin: 'DOGE', label: 'Dogecoin', encoderPort: 3123, minerPort: 3125 },
});

function rail(coin) {
    const found = RAILS[coin];
    if (!found) throw new Error(`no gas-token bootstrap rail is configured for ${coin}`);
    return found;
}

export function gasBridgeParams(coin, destination, amount = BRIDGE_AMOUNT) {
    if (coin === BTC_COIN) throw new Error('XCHAIN is issued directly on Bitcoin and is not bridged to it');
    if (!destination) throw new Error(`the ${coin} gas bridge needs a destination address`);
    return {
        VERSION: '0',
        DEST_COIN: rail(coin).coin,
        DEST_ADDRESS: destination,
        AMOUNT: String(amount),
    };
}

async function railRpc(port, method, params = {}) {
    let res;
    try {
        res = await fetch(`http://localhost:${port}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(30_000),
        });
    } catch (err) {
        // An off-BTC run reaches the Bitcoin rail too, so its encoder and miner
        // ports must be tunneled beside the venue's own; say which ones.
        const btc = rail(BTC_COIN);
        const ports = `-L ${btc.encoderPort}:localhost:${btc.encoderPort} -L ${btc.minerPort}:localhost:${btc.minerPort}`;
        throw new Error(`${method} on localhost:${port} did not answer (${err?.message || err}); `
            + (REGTEST_COIN === BTC_COIN
                ? `tunnel the Bitcoin regtest rail: ${ports}`
                : `XCHAIN reaches ${REGTEST_COIN} only over the bridge from Bitcoin regtest, so tunnel ${ports} beside the venue's own ports`));
    }
    const body = await res.json();
    if (body.error || body.result?.error) {
        throw new Error(`${method} failed: ${JSON.stringify(body.error || body.result.error)}`);
    }
    return body.result;
}

async function countRailUtxos(coin, address) {
    const result = await railRpc(rail(coin).encoderPort, 'get_utxos', { address });
    return Array.isArray(result?.utxos) ? result.utxos.length : 0;
}

async function fundRailAddress(coin, address, amount = 1) {
    const venue = rail(coin);
    const before = await countRailUtxos(coin, address);
    await railRpc(venue.minerPort, 'send_funds', { address, amount });
    await railRpc(venue.minerPort, 'generate_blocks', { count: 1 });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (await countRailUtxos(coin, address) > before) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`funding ${address} on ${coin} never appeared in the encoder`);
}

async function nudgeRail(coin) {
    try {
        const status = await fetch(`${EXPLORER_URL}/${coin}/api/status`, {
            signal: AbortSignal.timeout(10_000),
        }).then((res) => res.json());
        if (Number(status?.decoder_lag_blocks?.[coin] ?? 0) > 3) return;
        await railRpc(rail(coin).minerPort, 'generate_blocks', { count: 1 });
    } catch { /* global setup's venue check reports persistent rail failures */ }
}

/**
 * Classify a `/feequote` body for a MINT of the gas tick.
 *
 * Pure, so it can be falsified against recorded payloads. Three verdicts and
 * nothing in between: `present` (the venue would price the MINT), `absent`
 * (the venue names the tick as unknown), or a throw carrying the body, because
 * every other shape - a 500, a stale price, a missing field - is a different
 * venue problem and reading it as "absent" would ISSUE a second XCHAIN on a
 * chain that already has one, or hide a dead endpoint behind a bootstrap.
 *
 * @param {any} body
 * @returns {'present'|'absent'}
 */
export function gasTokenVerdict(body, coin = REGTEST_COIN) {
    const status = typeof body?.status === 'string' ? body.status : null;
    if (status === 'valid') return 'present';
    if (status && /TICK \(unknown\)/.test(status)) return 'absent';
    throw new Error(
        `cannot tell whether ${GAS_TICK} exists on ${coin}: the MINT quote answered `
        + `${JSON.stringify(body).slice(0, 300)} - neither a valid quote nor a TICK (unknown) refusal`,
    );
}

/** Check for the native Bitcoin faucet or the bridged off-BTC token row. */
export async function probeGasToken(coin = REGTEST_COIN, source = REGTEST_DESTINATION) {
    if (coin !== BTC_COIN) {
        const res = await fetch(`${EXPLORER_URL}/${coin}/api/token/${GAS_TICK}`, {
            signal: AbortSignal.timeout(30_000),
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.info?.tick === GAS_TICK) return 'present';
        if (res.ok && body === null) return 'absent';
        if (res.status === 404) return 'absent';
        throw new Error(
            `cannot tell whether ${GAS_TICK} exists on ${coin}: token lookup answered `
            + `${res.status} ${JSON.stringify(body).slice(0, 300)}`,
        );
    }
    const q = new URLSearchParams({
        action: 'MINT',
        params: `0|${GAS_TICK}|1`,
        source,
    });
    const res = await fetch(`${EXPLORER_URL}/${coin}/api/feequote?${q.toString()}`, {
        signal: AbortSignal.timeout(30_000),
    });
    return gasTokenVerdict(await res.json(), coin);
}

async function waitFor(predicate, { coins, timeoutMs, description }) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            if (await predicate()) return;
            lastError = null;
        } catch (err) {
            lastError = err;
        }
        for (const coin of coins) await nudgeRail(coin);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    throw new Error(`${description} did not land within ${Math.round(timeoutMs / 1000)}s`
        + (lastError ? `; last probe: ${lastError?.message || lastError}` : ''));
}

async function railTokenBalance(coin, address) {
    const res = await fetch(`${EXPLORER_URL}/${coin}/api/balances/${address}`, {
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`balance lookup on ${coin} answered ${res.status}`);
    const body = await res.json();
    const row = (body?.data || []).find((entry) => entry.tick === GAS_TICK);
    return Number(row?.amount || 0);
}

async function openBitcoinAdvancedAction(page, action) {
    await openPaletteCommand(page, 'Advanced action');
    const main = page.getByRole('main');
    await selectNamedChain(main, 'Network', rail(BTC_COIN).label);
    await page.getByLabel('Action', { exact: true }).selectOption(action);
    return main;
}

async function submitAdvancedAction(page, what) {
    await page.getByRole('button', { name: 'Sign action' }).click();
    await expectConfirmModal(page, what);
    await approveConfirm(page, what);
    await page.waitForTimeout(4_000);
}

/**
 * MINT on Bitcoin from `source` (one of the page wallet's own Bitcoin
 * addresses, already funded) and lock `amount` across to `destination` on the
 * venue chain with an XBRIDGE v0. One unit more than the lock is minted, the
 * margin the bootstrap has always carried, so the lock never meets a balance
 * short by its own fee. Returns once the lock is signed; the credit lands on
 * the venue only after the hub's relay margin, see waitForBridgedXchain.
 */
async function mintAndLockOnBitcoin(page, source, destination, amount) {
    const minted = amount + 1;
    const held = await railTokenBalance(BTC_COIN, source);
    await openBitcoinAdvancedAction(page, 'MINT');
    await page.getByRole('textbox', { name: 'TICK', exact: true }).fill(GAS_TICK);
    await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(minted));
    await submitAdvancedAction(page, `the MINT of ${minted} ${GAS_TICK} on Bitcoin`);
    await waitFor(
        () => railTokenBalance(BTC_COIN, source).then((balance) => balance >= held + minted),
        { coins: [BTC_COIN], timeoutMs: 180_000, description: `the ${GAS_TICK} MINT on Bitcoin` },
    );

    const bridge = gasBridgeParams(REGTEST_COIN, destination, amount);
    await openBitcoinAdvancedAction(page, 'XBRIDGE');
    await page.getByLabel('Format version', { exact: true }).selectOption(bridge.VERSION);
    for (const field of ['DEST_COIN', 'DEST_ADDRESS', 'AMOUNT']) {
        await page.getByRole('textbox', { name: field, exact: true }).fill(bridge[field]);
    }
    await submitAdvancedAction(page, `the XBRIDGE lock of ${amount} ${GAS_TICK} to ${REGTEST_COIN}`);
}

/**
 * The hub stamps a bridged credit a full relay margin ahead (LTC 600 s, DOGE
 * 240 s) and only settles it once Bitcoin buries the lock, so the wait mines
 * both rails and is sized past the margin.
 */
function bridgeWaitMs() {
    return REGTEST_COIN === 'RLTC' ? 780_000 : 420_000;
}

async function waitForBridgedXchain(destination, atLeast) {
    await waitFor(
        () => railTokenBalance(REGTEST_COIN, destination).then((balance) => balance >= atLeast),
        {
            coins: [BTC_COIN, REGTEST_COIN],
            timeoutMs: bridgeWaitMs(),
            description: `the bridged ${GAS_TICK} credit of ${atLeast} to ${destination} on ${REGTEST_COIN}`,
        },
    );
}

/**
 * Give `address`, the page wallet's own venue-chain address, `amount` XCHAIN.
 *
 * On Bitcoin this is the open faucet MINT. Off Bitcoin the bridged token is
 * mint-locked (MINT_START_BLOCK never arrives), so a MINT there can only be
 * refused; the spec's tokens come the way every venue's supply does instead:
 * minted on Bitcoin regtest and locked across with an XBRIDGE v0. That needs
 * the Bitcoin rail tunnelled beside the venue's own (encoder 3023, miner 3025).
 * The wallet must already be unlocked on regtest; this reloads it once, to see
 * the Bitcoin funding.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ address: string, amount: number, password: string }} opts
 */
export async function fundXchain(page, { address, amount, password }) {
    if (REGTEST_COIN === BTC_COIN) {
        await mintXchain(page, amount);
        return;
    }
    const held = await railTokenBalance(REGTEST_COIN, address);
    const main = await openBitcoinAdvancedAction(page, 'MINT');
    const source = await main.getByLabel('From', { exact: true }).inputValue();
    await fundRailAddress(BTC_COIN, source, 1);
    await page.reload();
    await unlockAfterReload(page, password);
    await mintAndLockOnBitcoin(page, source, address, amount);
    await waitForBridgedXchain(address, held + amount);
}

/**
 * Seed the gas token through the wallet itself. Bitcoin uses ISSUE directly.
 * Other chains use the platform supply path: ISSUE and MINT on Bitcoin, then an
 * XBRIDGE v0 lock to the throwaway wallet's destination-chain address.
 *
 * @param {{ baseURL: string, log?: (line: string) => void }} opts
 */
export async function ensureGasToken({ baseURL, log = console.log }) {
    if (await probeGasToken() === 'present') {
        log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} already present on the venue`);
        return { issued: false };
    }
    const bridged = REGTEST_COIN !== BTC_COIN;
    log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} is NOT present on this venue (fresh genesis?); `
        + (bridged ? 'issuing it on Bitcoin and bridging it through the wallet' : 'issuing it through the wallet'));

    // The same browser the specs get: the project's launch args let the wallet
    // read the explorer cross-origin, and the spec fixture's license bypass is
    // seeded here by hand because this page is not a test's `page`.
    const browser = await chromium.launch({
        args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
    });
    let page = null;
    let source = null;
    try {
        const context = await browser.newContext({
            ...devices['Desktop Chrome'], userAgent: desktopUserAgentForHost(), baseURL,
        });
        await context.addInitScript(
            ([atKey, versionKey, version]) => {
                try {
                    window.localStorage.setItem(atKey, new Date().toISOString());
                    window.localStorage.setItem(versionKey, version);
                } catch { /* storage may be unavailable; the gate then shows and names itself */ }
            },
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
        );
        // Global setup has no test timeout behind it, so an unbounded click on a
        // control that never appears would hang the run before any spec starts.
        context.setDefaultTimeout(60_000);
        page = await context.newPage();
        await createWallet(page, { password: BOOTSTRAP_PASSWORD, name: 'Gas bootstrap' });
        await switchToRegtest(page, BOOTSTRAP_PASSWORD);
        const destination = bridged ? await readReceiveAddress(page) : null;

        const main = await openBitcoinAdvancedAction(page, 'ISSUE');
        source = await main.getByLabel('From', { exact: true }).inputValue();
        await fundRailAddress(BTC_COIN, source, 1);
        await page.reload();
        await unlockAfterReload(page, BOOTSTRAP_PASSWORD);

        if (await probeGasToken(BTC_COIN, source) === 'absent') {
            await openBitcoinAdvancedAction(page, 'ISSUE');
            await page.getByRole('textbox', { name: 'TICK', exact: true }).fill(GAS_TICK);
            for (const [field, value] of Object.entries(GAS_ISSUE)) {
                const box = page.getByRole('textbox', { name: field, exact: true });
                await expect(box, `the ISSUE form renders no "${field}" field, so the gas token cannot be issued with the e2e-test suite's parameters`)
                    .toBeVisible({ timeout: 15_000 });
                await box.fill(value);
            }
            await submitAdvancedAction(page, `the ISSUE of ${GAS_TICK} on Bitcoin`);
            await waitFor(
                () => probeGasToken(BTC_COIN, source).then((verdict) => verdict === 'present'),
                { coins: [BTC_COIN], timeoutMs: 180_000, description: `the ${GAS_TICK} ISSUE on Bitcoin` },
            );
        }

        if (bridged) await mintAndLockOnBitcoin(page, source, destination, BRIDGE_AMOUNT);
    } catch (err) {
        // Global setup has no test artifacts, so a locator timeout here would
        // otherwise be a stack trace and nothing else. Name the screen instead.
        let screen = '';
        let shot = '';
        try {
            shot = `tmp/gas-token-bootstrap-${REGTEST_COIN}.png`;
            await page?.screenshot({ path: shot, fullPage: true });
            screen = (await page?.locator('body').innerText())?.replace(/\s+/g, ' ').slice(0, 800) || '';
        } catch { /* the page itself may be gone; the original error still names the step */ }
        throw new Error(
            `[regtest ${REGTEST_COIN}] gas-token bootstrap failed: ${err?.message || err}\n`
            + `  screen: ${screen || '(unreadable)'}\n  screenshot: ${shot || '(none)'}`,
        );
    } finally {
        await browser.close();
    }

    await waitFor(
        () => probeGasToken().then((verdict) => verdict === 'present'),
        {
            coins: bridged ? [BTC_COIN, REGTEST_COIN] : [BTC_COIN],
            timeoutMs: bridged ? bridgeWaitMs() : 180_000,
            description: bridged
                ? `the bridged ${GAS_TICK} credit on ${REGTEST_COIN}`
                : `the ${GAS_TICK} ISSUE on ${REGTEST_COIN}`,
        },
    );
    log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} ${bridged ? 'bridged from Bitcoin' : 'issued'} and visible on the venue`);
    return { issued: true, source, bridged };
}
