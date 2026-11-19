// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §20: wallet mode moved from one app-wide setting onto each wallet record
// (wallet schema v3 -> v4). A vault written before the move holds v3 wallets
// and the mode in its sparse settings; reading the wallets forward copies
// that mode onto every one, and the copy survives later writes and reopens.

import { describe, expect, it } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { emptyDocument, encodeDocument } from '../../../packages/core/src/storage/codec.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { CURRENT_VERSION as SETTINGS_VERSION } from '../../../packages/core/src/schemas/settings.js';

const KEY = new Uint8Array(32).fill(41);
const KDF = { algorithm: 'argon2id', salt: 'c2FsdA==', iterations: 3, memory: 65536, parallelism: 1 };

function v3Wallet(name) {
    const { walletMode: _dropped, ...rest } = createWallet({
        name,
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'c2VlZA==',
        kdfParams: KDF,
    });
    return { ...rest, schemaVersion: 3 };
}

/** A backend holding a pre-v4 vault: two v3 wallets and the app-wide mode. */
async function legacyBackend(legacySettings) {
    const backend = new InMemoryBackend();
    const document = {
        ...emptyDocument(),
        wallets: [v3Wallet('First'), v3Wallet('Second')],
        settings: legacySettings,
    };
    await backend.save(await encodeDocument(KEY, document));
    return backend;
}

async function openVault(backend) {
    const vault = new Vault({ backend, masterKey: KEY });
    await vault.open();
    return vault;
}

describe('Vault wallet-mode migration (wallet v3 -> v4)', () => {
    it('copies the legacy app-wide mode onto every existing wallet', async () => {
        const vault = await openVault(await legacyBackend({ schemaVersion: SETTINGS_VERSION, walletMode: 'watcher' }));
        const wallets = await vault.wallets.list();
        expect(wallets.map((w) => [w.schemaVersion, w.walletMode])).toEqual([[4, 'watcher'], [4, 'watcher']]);
    });

    it('reads an unchanged legacy mode (absent from sparse settings) as Normal', async () => {
        const vault = await openVault(await legacyBackend({ schemaVersion: SETTINGS_VERSION }));
        expect((await vault.wallets.list()).map((w) => w.walletMode)).toEqual(['full', 'full']);
    });

    it('keeps the copied mode across an unrelated settings write and a reopen', async () => {
        const backend = await legacyBackend({ schemaVersion: SETTINGS_VERSION, walletMode: 'signer' });
        const vault = await openVault(backend);
        // One wallet is read forward before the write, the other is not.
        const [first] = await vault.wallets.list();
        expect(first.walletMode).toBe('signer');
        const settings = await vault.settings.get();
        await vault.settings.put({ ...settings, theme: 'dark' });

        const reopened = await openVault(backend);
        expect((await reopened.wallets.list()).map((w) => w.walletMode)).toEqual(['signer', 'signer']);
        expect((await reopened.settings.get()).theme).toBe('dark');
    });

    it('a rerun is a no-op: a v4 wallet keeps its own mode whatever the legacy key says', async () => {
        const backend = await legacyBackend({ schemaVersion: SETTINGS_VERSION, walletMode: 'watcher' });
        const vault = await openVault(backend);
        const [first, second] = await vault.wallets.list();
        await vault.wallets.put({ ...second, walletMode: 'full' });

        const reopened = await openVault(backend);
        const again = await reopened.wallets.list();
        expect(again.find((w) => w.id === first.id).walletMode).toBe('watcher');
        expect(again.find((w) => w.id === second.id).walletMode).toBe('full');
    });
});
