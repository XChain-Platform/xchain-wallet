// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security: the web shell must NEVER write the user's plaintext wallet
// password to any Web API storage. The threat model (§1, §2.1:
// https://docs.xchain.io/components/wallet/threat-model) states the password is held in JavaScript memory only for the
// duration of a single operation and a page reload re-locks the wallet.
// A regression here would hand any same-origin script (XSS sink,
// compromised dependency) a reusable credential that decrypts the vault.
//
// We drive the three flows that take a password (unlock, createWallet,
// importMnemonic) through the real web-shell messaging layer (with the
// in-page host stubbed) and assert sessionStorage holds neither the
// dedicated cache key nor the password value under ANY key.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const SECRET = 'correct-horse-battery-staple-9271';

// Stub the in-page host so the flows resolve without a real vault. The
// path is resolved to the same module specifier messaging.js imports.
vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: vi.fn(async () => ({})),
    getSessionStatus: vi.fn(async () => ({ state: 'locked' })),
    unlockWalletLocal: vi.fn(async () => ({ ok: true })),
    lockWalletLocal: vi.fn(async () => ({ ok: true })),
    createWalletLocal: vi.fn(async () => ({ mnemonic: 'm', walletName: 'w' })),
    importMnemonicLocal: vi.fn(async () => ({ format: 'bip39', walletName: 'w' })),
}));

import * as messaging from '../../../packages/web/src/messaging.js';

/** Every value currently held in sessionStorage. */
function sessionStorageValues() {
    const out = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        out.push(window.sessionStorage.getItem(key));
    }
    return out;
}

function assertPasswordNotStored() {
    // The historical cache key must never reappear.
    expect(window.sessionStorage.getItem('xc.session.pw')).toBeNull();
    // And the password must not be stashed under any other key either.
    expect(sessionStorageValues()).not.toContain(SECRET);
}

describe('security/passwords/no-password-in-sessionstorage', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
    });

    it('unlockWallet does not write the password to sessionStorage', async () => {
        await messaging.unlockWallet(SECRET);
        assertPasswordNotStored();
    });

    it('createWallet does not write the password to sessionStorage', async () => {
        await messaging.createWallet({ password: SECRET, name: 'My Wallet' });
        assertPasswordNotStored();
    });

    it('importMnemonic does not write the password to sessionStorage', async () => {
        await messaging.importMnemonic({
            password: SECRET,
            mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
        });
        assertPasswordNotStored();
    });

    it('the password is absent from localStorage as well', async () => {
        await messaging.unlockWallet(SECRET);
        for (let i = 0; i < window.localStorage.length; i++) {
            expect(window.localStorage.getItem(window.localStorage.key(i))).not.toBe(SECRET);
        }
    });
});
