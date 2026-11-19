// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: per-wallet active-account memory round-trip. localStorage is
// provided by the jsdom test environment.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    readActiveAccount,
    writeActiveAccount,
    clearActiveAccount,
} from '../../../packages/core/src/shared/utils/activeAccountMemory.js';
import { reconcileActiveAccount } from '../../../packages/core/src/shared/utils/activeAccountScope.js';

const shells = [
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
    'packages/extension/src/popup/App.jsx',
];
const sendSource = readFileSync('packages/core/src/shared/routes/Send.jsx', 'utf8');

describe('activeAccountMemory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns null when nothing is stored', () => {
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('persists and reads back the active account per wallet', () => {
        writeActiveAccount('wallet-1', 'acct-9');
        writeActiveAccount('wallet-2', 'acct-3');
        expect(readActiveAccount('wallet-1')).toBe('acct-9');
        expect(readActiveAccount('wallet-2')).toBe('acct-3');
    });

    it('clears a wallet entry', () => {
        writeActiveAccount('wallet-1', 'acct-9');
        clearActiveAccount('wallet-1');
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('ignores missing wallet id or account id', () => {
        writeActiveAccount('', 'acct-9');
        writeActiveAccount('wallet-1', '');
        expect(readActiveAccount('')).toBe(null);
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('keeps a saved account that still belongs to the wallet', () => {
        writeActiveAccount('wallet-1', 'acct-9');

        expect(reconcileActiveAccount('wallet-1', [
            { id: 'acct-2', index: 0 },
            { id: 'acct-9', index: 1 },
        ])).toBe('acct-9');
        expect(readActiveAccount('wallet-1')).toBe('acct-9');
    });

    it('replaces a removed saved account with the lowest live account', () => {
        writeActiveAccount('wallet-1', 'acct-removed');

        expect(reconcileActiveAccount('wallet-1', [
            { id: 'acct-3', index: 2 },
            { id: 'acct-1', index: 0 },
        ])).toBe('acct-1');
        expect(readActiveAccount('wallet-1')).toBe('acct-1');
    });

    it('clears a saved account when the wallet has no accounts', () => {
        writeActiveAccount('wallet-1', 'acct-removed');

        expect(reconcileActiveAccount('wallet-1', [])).toBe(null);
        expect(readActiveAccount('wallet-1')).toBe(null);
    });

    it('tags new sends with the active account', () => {
        expect(sendSource).toContain('...(accountId ? { accountId } : {})');
    });
});

describe.each(shells)('%s active account wiring', (path) => {
    const source = readFileSync(path, 'utf8');

    it('reconciles startup selection and supports clearing the selection', () => {
        expect(source).toContain('reconcileActiveAccount(activeWalletId, sorted)');
        expect(source).toContain('else clearActiveAccount(activeWalletId);');
    });

    it('remounts account-scoped balance, history, receive, and send surfaces', () => {
        const scopeKey = "key={`${activeWalletId}:${activeAccountId || 'all'}`}";
        expect(source).toContain(`<Fragment ${scopeKey}>`);
        for (const route of ['History', 'Receive', 'Send']) {
            expect(source).toMatch(new RegExp(
                `<${route}\\s+[\\s\\S]*?${scopeKey.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s\\S]*?accountId=\\{activeAccountId \\|\\| undefined\\}`,
            ));
        }
    });
});
