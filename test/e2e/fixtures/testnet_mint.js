// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { expect } from '@playwright/test';
import { compareDecimal, subtractDecimal } from '../../../packages/core/src/shared/utils/mintHeadroom.js';
import { openPaletteCommand } from './wallet.js';
import { approveConfirm, expectConfirmModal } from './regtest.js';
import { TESTNET_ADDRESS_RE, TESTNET_CHAIN_LABEL } from './testnet.js';

/**
 * Reads the remaining XCHAIN supply capacity from a testnet explorer.
 *
 * @param {{ explorerUrl: string, coin: string, fetch?: typeof globalThis.fetch }} opts
 * @returns {Promise<string | null>}
 */
export async function readTestnetGasHeadroom({
    explorerUrl,
    coin,
    fetch: fetchImpl = globalThis.fetch,
}) {
    let response;
    try {
        response = await fetchImpl(
            `${String(explorerUrl).replace(/\/$/, '')}/${coin}/api/token/XCHAIN`,
            { signal: AbortSignal.timeout(30_000) },
        );
    } catch (error) {
        const code = [error?.cause?.code, error?.code, error?.name]
            .find((value) => typeof value === 'string' && /^[A-Za-z_]{2,40}$/.test(value))
            || 'unknown';
        throw new Error(`Gas headroom read failed: ${code}`);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`Gas headroom read failed: HTTP ${response.status}`);
    }

    const row = await response.json().catch(() => null);
    const max = row?.supply?.max;
    const current = row?.supply?.current;
    if (max == null || current == null) return null;
    return subtractDecimal(String(max), String(current));
}

/** Mints XCHAIN to the active Bitcoin testnet address through Advanced action. */
export async function mintTestnetXchain(page, amount, opts) {
    const headroom = await readTestnetGasHeadroom(opts);
    if (headroom !== null && compareDecimal(headroom, String(amount)) === -1) {
        throw new Error(`XCHAIN mint headroom ${headroom} is below requested amount ${amount}`);
    }

    await openPaletteCommand(page, 'Advanced action');

    const network = page.getByRole('button', { name: /^Network:/ }).first();
    await expect(network, 'no "Network" chain picker on this screen')
        .toBeVisible({ timeout: 30_000 });
    if (!((await network.getAttribute('aria-label')) || '').includes(TESTNET_CHAIN_LABEL)) {
        await network.click();
        await page.getByRole('option', { name: new RegExp(`^${TESTNET_CHAIN_LABEL}\\b`) })
            .first().click();
    }
    await expect(network).toHaveAttribute('aria-label', new RegExp(TESTNET_CHAIN_LABEL), {
        timeout: 15_000,
    });
    await expect(page.getByLabel('From', { exact: true })).toHaveValue(TESTNET_ADDRESS_RE, {
        timeout: 15_000,
    });

    await page.getByLabel('Action', { exact: true }).selectOption('MINT');
    await page.getByRole('textbox', { name: 'TICK', exact: true }).fill('XCHAIN');
    await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(amount));
    await page.getByRole('button', { name: 'Sign action' }).click();

    await expectConfirmModal(page, `the MINT of ${amount} XCHAIN`);
    await approveConfirm(page, `the MINT of ${amount} XCHAIN`);
}
