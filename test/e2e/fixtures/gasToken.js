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
// spec asks to MINT it.
//
// WHY THIS EXISTS, measured 2026-09-01. The regtest stack was re-genesised
// (every chain restarted from height 0) and the first spec to run afterwards
// died in its setup with the wallet's own sentence on screen: "The network
// would refuse this action as it stands: TICK (unknown)". Every spec in this
// suite funds itself through `mintXchain`, and XCHAIN is not a protocol
// constant on LTC/DOGE regtest: it is an ordinary open-mint ISSUE that the
// xchain-e2e-test suite plants in its own `gas-token-check` phase
// (test/initialCheck.test.js), through a DB-backed helper this harness cannot
// reach. Until that suite happened to run, this one could not fund a single
// address, and the failure blamed a MINT rather than a missing issuance.
//
// The parameters below are that phase's, byte for byte, so the two suites
// agree about what XCHAIN is on a fresh chain: no pre-minted supply, minting
// left unlocked and open from genesis, a per-transaction cap high enough that
// `mintXchain(page, 5000)` is never throttled.
//
// The probe is the venue's own fee quote for a MINT of the tick, which is the
// read the wallet makes before it signs: a present tick quotes `valid`, an
// absent one answers `invalid: TICK (unknown)`. Holder counts cannot stand in
// for it, because a faucet with `MINT_SUPPLY 0` has no holders until someone
// mints.

import { chromium, devices, expect } from '@playwright/test';
import {
    EXPLORER_URL, REGTEST_COIN, REGTEST_DESTINATION,
    fundAddress, switchToRegtest, unlockAfterReload, readReceiveAddress,
    selectVenueChain, expectConfirmModal, nudgeChain,
} from './regtest.js';
import { createWallet, LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY } from './wallet.js';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

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
export function gasTokenVerdict(body) {
    const status = typeof body?.status === 'string' ? body.status : null;
    if (status === 'valid') return 'present';
    if (status && /TICK \(unknown\)/.test(status)) return 'absent';
    throw new Error(
        `cannot tell whether ${GAS_TICK} exists on ${REGTEST_COIN}: the MINT quote answered `
        + `${JSON.stringify(body).slice(0, 300)} - neither a valid quote nor a TICK (unknown) refusal`,
    );
}

/** Ask the venue whether it would price a MINT of the gas tick right now. */
export async function probeGasToken() {
    const q = new URLSearchParams({
        action: 'MINT',
        params: `0|${GAS_TICK}|1`,
        source: REGTEST_DESTINATION,
    });
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote?${q.toString()}`, {
        signal: AbortSignal.timeout(30_000),
    });
    return gasTokenVerdict(await res.json());
}

/**
 * ISSUE the gas token through the wallet itself, from a throwaway wallet whose
 * first venue-chain address is funded by the miner. The whole path is the one
 * every spec already trusts (`createWallet` -> `switchToRegtest` -> the
 * Advanced-action form -> the confirm modal), so a bootstrap failure reads the
 * same way a spec failure does and names the screen's own sentence.
 *
 * @param {{ baseURL: string, log?: (line: string) => void }} opts
 */
export async function ensureGasToken({ baseURL, log = console.log }) {
    if (await probeGasToken() === 'present') {
        log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} already issued on the venue`);
        return { issued: false };
    }
    log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} is NOT issued on this venue (fresh genesis?); issuing it through the wallet`);

    // The same browser the specs get: the project's launch args let the wallet
    // read the explorer cross-origin, and the spec fixture's license bypass is
    // seeded here by hand because this page is not a test's `page`.
    const browser = await chromium.launch({
        args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
    });
    let page = null;
    let source = null;
    try {
        const context = await browser.newContext({ ...devices['Desktop Chrome'], baseURL });
        await context.addInitScript(
            ([atKey, versionKey, version]) => {
                try {
                    window.localStorage.setItem(atKey, new Date().toISOString());
                    window.localStorage.setItem(versionKey, version);
                } catch { /* storage may be unavailable; the gate then shows and names itself */ }
            },
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
        );
        page = await context.newPage();
        await createWallet(page, { password: BOOTSTRAP_PASSWORD, name: 'Gas bootstrap' });
        await switchToRegtest(page, BOOTSTRAP_PASSWORD);
        source = await readReceiveAddress(page);
        await fundAddress(source, 1);
        await page.reload();
        await unlockAfterReload(page, BOOTSTRAP_PASSWORD);

        await page.keyboard.press('ControlOrMeta+k');
        const dialog = page.getByRole('dialog', { name: 'Command palette' });
        await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
        const combobox = dialog.getByRole('combobox').first();
        await expect(combobox).toBeVisible();
        await combobox.fill('Advanced action');
        await page.keyboard.press('Enter');
        await selectVenueChain(page);
        await page.getByLabel('Action').selectOption('ISSUE');
        await page.getByRole('textbox', { name: 'TICK', exact: true }).fill(GAS_TICK);
        for (const [field, value] of Object.entries(GAS_ISSUE)) {
            const box = page.getByRole('textbox', { name: field, exact: true });
            await expect(box, `the ISSUE form renders no "${field}" field, so the gas token cannot be issued with the e2e-test suite's parameters`)
                .toBeVisible({ timeout: 15_000 });
            await box.fill(value);
        }
        await page.getByRole('button', { name: 'Sign action' }).click();
        await expectConfirmModal(page, `the ISSUE of ${GAS_TICK}`);
        await page.getByTestId('confirm-approve').click();
        await page.waitForTimeout(4_000);
    } catch (err) {
        // Global setup has no test artifacts, so a locator timeout here would
        // otherwise be a stack trace and nothing else. Name the screen instead.
        let screen = '';
        let shot = '';
        try {
            shot = `test-results-regtest/gas-token-bootstrap-${REGTEST_COIN}.png`;
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

    // The issuance is real only once the venue prices a MINT of it, which is
    // the read the specs will make; mine towards that rather than waiting on
    // the form's own terminal screen.
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 3_000));
        if (await probeGasToken() === 'present') {
            log(`[regtest ${REGTEST_COIN}] gas token ${GAS_TICK} issued: the venue now prices a MINT of it`);
            return { issued: true, source };
        }
    }
    throw new Error(
        `[regtest ${REGTEST_COIN}] the ${GAS_TICK} ISSUE was approved in the wallet but the venue still `
        + 'does not price a MINT of it after 180s; check the action on the explorer before re-running',
    );
}
