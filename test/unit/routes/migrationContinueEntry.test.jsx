// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// While a Migrate-to-BIP39 list still has legacy addresses to sweep, the
// legacy wallet offers Continue migration (Home alert and wallet details)
// in place of a fresh upgrade. Once every row is swept or the list is
// dismissed, the upgrade entry comes back.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { buildWalletAlerts } from '../../../packages/core/src/shared/walletAlerts.js';
import {
    clearMigrationSweeps,
    dismissMigrationSweeps,
    markMigrationSwept,
    recordMigration,
    setMigrationRows,
} from '../../../packages/core/src/flows/migrationSweeps.js';

const legacy = { id: 'wallet-old', name: 'FreeWallet', format: 'counterwallet-legacy', origin: 'imported', passphraseEnabled: false };
const noop = () => {};

function keepList() {
    recordMigration('wallet-old', 'wallet-new');
    setMigrationRows('wallet-old', 'wallet-new', [
        { chainId: 'bitcoin', fromAddress: 'legacy-0', toAddress: 'new-0' },
        { chainId: 'bitcoin', fromAddress: 'legacy-1', toAddress: 'new-0' },
    ]);
}

async function upgradeButtonText() {
    const target = {
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listAccounts: () => Promise.resolve([]),
        listWallets: () => Promise.resolve([legacy]),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            return prop in t ? t[prop] : () => Promise.resolve(undefined);
        },
    });
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <WalletDetails walletId={legacy.id} onBack={noop} onMigrateToBip39={noop} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    const texts = [...utils.container.querySelectorAll('button')].map((b) => b.textContent.trim());
    cleanup();
    return texts.find((text) => /Upgrade recovery phrase|Continue migration/.test(text)) || null;
}

afterEach(() => {
    cleanup();
    clearMigrationSweeps();
    localStorage.clear();
});

describe('Continue migration entry on the legacy wallet', () => {
    it('the Home alert offers the kept list while a row is unswept', () => {
        keepList();
        const [alert] = buildWalletAlerts({ activeWallet: legacy }, { onMigrateToBip39: noop });
        expect(alert.id).toBe('migration-sweeps');
        expect(alert.action.label).toBe('Continue migration');
        expect(alert.action.onSelect).toBe(noop);
    });

    it('the Home alert goes back to the upgrade once every row is swept or the list is dismissed', () => {
        keepList();
        markMigrationSwept('wallet-old', { newWalletId: 'wallet-new', chainId: 'bitcoin', fromAddress: 'legacy-0', txid: 't0' });
        markMigrationSwept('wallet-old', { newWalletId: 'wallet-new', chainId: 'bitcoin', fromAddress: 'legacy-1', txid: 't1' });
        expect(buildWalletAlerts({ activeWallet: legacy }, { onMigrateToBip39: noop })[0].id).toBe('legacy-format');

        keepList();
        dismissMigrationSweeps('wallet-old');
        expect(buildWalletAlerts({ activeWallet: legacy }, { onMigrateToBip39: noop })[0].id).toBe('legacy-format');
    });

    it('a kept list for another wallet leaves this one on the upgrade', () => {
        recordMigration('someone-else', 'wallet-new');
        expect(buildWalletAlerts({ activeWallet: legacy }, { onMigrateToBip39: noop })[0].id).toBe('legacy-format');
    });

    it('wallet details labels the entry Continue migration while a row is unswept', async () => {
        expect(await upgradeButtonText()).toBe('Upgrade recovery phrase');
        keepList();
        expect(await upgradeButtonText()).toBe('Continue migration');
        dismissMigrationSweeps('wallet-old');
        expect(await upgradeButtonText()).toBe('Upgrade recovery phrase');
    });
});
