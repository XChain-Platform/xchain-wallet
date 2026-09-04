// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The wallet.list projection (`toSafeWallet` in
// createBackgroundHost.js) derives `passphraseStored` from
// `encryptedPassphrase` so the UI (WalletDetails, ComposeMessage) can tell
// "stored" (unlock needs nothing further) apart from "needs its passphrase
// once" (passphraseEnabled but not yet captured), without the ciphertext
// itself ever reaching the UI.
//
// `createBackgroundHost` is the ONE message-routing surface behind every
// shell: the web host (packages/web/src/hostBridge.js) imports it directly
// rather than reimplementing `toSafeWallet`, so driving `wallet.list`
// through the host here exercises the exact code path both the extension
// and the web shell use. A companion assertion below pins that import so a
// future fork of the web host would fail this file instead of silently
// drifting.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

/** Same in-memory opt-out shape used by test/integration/shells/background-host.test.js. */
function makeHost(wallets) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => wallets },
        },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
    });
}

const BASE = {
    schemaVersion: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'created',
    format: 'bip39',
    multisigs: [],
};

const STORED_WALLET = {
    ...BASE,
    id: 'w-stored',
    name: 'Stored',
    passphraseEnabled: true,
    encryptedPassphrase: 'YmFzZTY0LWNpcGhlcnRleHQ=',
};

const LEGACY_WALLET = {
    ...BASE,
    id: 'w-legacy',
    name: 'Legacy',
    passphraseEnabled: true,
    encryptedPassphrase: null,
};

const NO_PASSPHRASE_WALLET = {
    ...BASE,
    id: 'w-none',
    name: 'NoPassphrase',
    passphraseEnabled: false,
    encryptedPassphrase: null,
};

async function listWallets(wallets) {
    const host = makeHost(wallets);
    const res = await host.handle({ type: 'wallet.list' });
    expect(res.ok).toBe(true);
    return res.result;
}

describe('wallet.list projection: passphraseStored (§15.6)', () => {
    it('projects passphraseStored true for a wallet with a stored passphrase', async () => {
        const [projected] = await listWallets([STORED_WALLET]);
        expect(projected.passphraseEnabled).toBe(true);
        expect(projected.passphraseStored).toBe(true);
    });

    it('distinguishes a legacy wallet (enabled, not yet captured) from a stored one', async () => {
        const [projected] = await listWallets([LEGACY_WALLET]);
        expect(projected.passphraseEnabled).toBe(true);
        expect(projected.passphraseStored).toBe(false);
    });

    it('projects both flags false for a no-passphrase wallet', async () => {
        const [projected] = await listWallets([NO_PASSPHRASE_WALLET]);
        expect(projected.passphraseEnabled).toBe(false);
        expect(projected.passphraseStored).toBe(false);
    });

    it('never lets encryptedPassphrase itself cross the projection, in any state', async () => {
        const projected = await listWallets([STORED_WALLET, LEGACY_WALLET, NO_PASSPHRASE_WALLET]);
        for (const w of projected) {
            expect(Object.prototype.hasOwnProperty.call(w, 'encryptedPassphrase')).toBe(false);
        }
    });

    it('the web host reuses this exact projection rather than a second implementation', () => {
        const hostBridgePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../../packages/web/src/hostBridge.js',
        );
        const src = readFileSync(hostBridgePath, 'utf8');
        expect(src).toMatch(
            /from ['"]\.\.\/\.\.\/extension\/src\/background\/createBackgroundHost\.js['"]/,
        );
    });
});
