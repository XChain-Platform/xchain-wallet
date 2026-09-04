// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: WalletPicker's badge and WalletDetails' passphrase row must read
// `passphraseStored`, not `passphraseEnabled` alone, now that a stored
// 25th-word passphrase makes the password the only secret unlock needs.
//
// Before this row, both surfaces warned about EVERY `passphraseEnabled`
// wallet, so a wallet that already had its passphrase stored (nothing left
// for the user to do) still got flagged next to one that genuinely still
// owes its one-time capture. Proves the stored case now shows no warning
// anywhere, and only the not-yet-captured case does, pointing at the
// unlock screen as the remedy rather than a field on this screen.

import { describe, it, expect } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';

async function drainMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function stubMessaging(overrides = {}) {
    const target = {
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listAccounts: () => Promise.resolve([]),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve(undefined);
        },
    });
}

const NO_PASSPHRASE = { id: 'w1', name: 'Plain wallet', format: 'bip39', passphraseEnabled: false, passphraseStored: false };
const STORED = { id: 'w2', name: 'Stored one', format: 'bip39', passphraseEnabled: true, passphraseStored: true };
const AWAITING_CAPTURE = { id: 'w3', name: 'Legacy one', format: 'bip39', passphraseEnabled: true, passphraseStored: false };

describe('WalletPicker badges read passphraseStored', () => {
    async function renderPicker(wallets) {
        const messaging = stubMessaging({ listWallets: () => Promise.resolve(wallets) });
        let utils;
        await domAct(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(WalletPicker, {
                        activeWalletId: null, onSwitch() {}, onAddWallet() {}, onBack() {},
                    }),
                ),
            );
            await drainMicrotasks();
        });
        return utils;
    }

    it('shows no badge for a wallet with no passphrase at all', async () => {
        const utils = await renderPicker([NO_PASSPHRASE]);
        expect(utils.container.textContent).not.toMatch(/passphrase/i);
    });

    it('shows no badge for a wallet whose passphrase is already stored', async () => {
        const utils = await renderPicker([STORED]);
        expect(utils.container.textContent, 'a stored-passphrase wallet needs nothing from the user')
            .not.toMatch(/passphrase/i);
    });

    it('badges only the legacy wallet still owed its one-time capture, pointing at unlock', async () => {
        const utils = await renderPicker([AWAITING_CAPTURE]);
        expect(utils.container.textContent).toMatch(/needs its passphrase/i);
        expect(utils.container.textContent, 'names the unlock screen, not a field on this screen')
            .toMatch(/unlock/i);
    });

    it('badges only the not-yet-captured wallet when both are listed side by side', async () => {
        const utils = await renderPicker([STORED, AWAITING_CAPTURE]);
        const rows = Array.from(utils.container.querySelectorAll('button')).map((n) => n.textContent || '');
        const storedRow = rows.find((t) => t.includes('Stored one'));
        const legacyRow = rows.find((t) => t.includes('Legacy one'));
        expect(storedRow, 'the stored wallet\'s own row carries no warning').not.toMatch(/needs its passphrase/i);
        expect(legacyRow, 'the legacy wallet\'s row carries the warning').toMatch(/needs its passphrase/i);
    });
});

describe('WalletDetails passphrase row reads passphraseStored', () => {
    async function renderDetails(wallet) {
        const messaging = stubMessaging({ listWallets: () => Promise.resolve([wallet]) });
        let utils;
        await domAct(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(WalletDetails, { walletId: wallet.id, onBack() {} }),
                ),
            );
            await drainMicrotasks();
        });
        return utils;
    }

    it('reads "Disabled" when the wallet has no passphrase', async () => {
        const utils = await renderDetails(NO_PASSPHRASE);
        expect(utils.container.textContent).toMatch(/Disabled/);
    });

    it('reads "Stored" when the passphrase is captured, with no call to action', async () => {
        const utils = await renderDetails(STORED);
        expect(utils.container.textContent).toMatch(/Stored/);
        expect(utils.container.textContent, 'a stored passphrase needs no further step')
            .not.toMatch(/needs its passphrase/i);
    });

    it('names the one-time capture and points at the unlock screen when still awaited', async () => {
        const utils = await renderDetails(AWAITING_CAPTURE);
        expect(utils.container.textContent).toMatch(/needs its passphrase once/i);
        expect(utils.container.textContent, 'the remedy is the unlock screen, not a field here')
            .toMatch(/unlock screen/i);
    });
});
