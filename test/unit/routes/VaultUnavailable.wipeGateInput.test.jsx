// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The type-WIPE gate under keyboards that are not US English, and the wipe
// itself with the network gone.
//
// The confirm field carries autoCapitalize="characters", so a Turkish
// keyboard turns the typed "i" into U+0130 (capital I with dot above). The
// gate folds that letter to "I" so a user who types exactly what the label
// asks for can confirm, while look-alike letters keep it shut.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { VaultUnavailable } from '../../../packages/core/src/shared/routes/VaultUnavailable.jsx';
import { wipeWalletStorage } from '../../../packages/core/src/shared/utils/wipeWalletStorage.js';

afterEach(cleanup);

function renderScreen(props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: {} },
            React.createElement(VaultUnavailable, { kind: 'corrupt', ...props }),
        ),
    );
}

function openGate(props) {
    renderScreen(props);
    fireEvent.click(screen.getByText(/restore from recovery phrase or backup/i));
    return {
        field: screen.getByLabelText(/type wipe to confirm/i),
        confirm: screen.getByRole('button', { name: /remove damaged data/i }),
    };
}

describe('type-WIPE gate input', () => {
    it('opens for WIPE typed on a Turkish keyboard with caps (U+0130)', async () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        const { field, confirm } = openGate({ wipe, onRetry: vi.fn() });
        fireEvent.change(field, { target: { value: 'WİPE' } });
        await waitFor(() => expect(confirm.disabled).toBe(false));
        fireEvent.click(confirm);
        await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1));
    });

    it('keeps the ASCII gate: wipe and padded WIPE open, WIPEX stays shut', async () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        const { field, confirm } = openGate({ wipe, onRetry: vi.fn() });
        for (const value of ['wipe', ' WIPE ']) {
            fireEvent.change(field, { target: { value } });
            await waitFor(() => expect(confirm.disabled).toBe(false));
        }
        fireEvent.change(field, { target: { value: 'WIPEX' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.click(confirm);
        expect(wipe).not.toHaveBeenCalled();
    });

    it('opens for lowercase wipe whatever the document locale', async () => {
        document.documentElement.lang = 'tr-TR';
        const wipe = vi.fn().mockResolvedValue(undefined);
        const { field, confirm } = openGate({ wipe, onRetry: vi.fn() });
        fireEvent.change(field, { target: { value: 'wipe' } });
        await waitFor(() => expect(confirm.disabled).toBe(false));
        document.documentElement.lang = 'en';
    });

    it('stays shut through an IME composition until the word is whole', async () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        const { field, confirm } = openGate({ wipe, onRetry: vi.fn() });
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: 'WI' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.click(confirm);
        expect(wipe).not.toHaveBeenCalled();
        fireEvent.change(field, { target: { value: 'WIPE' } });
        fireEvent.compositionEnd(field);
        await waitFor(() => expect(confirm.disabled).toBe(false));
    });

    it('stays shut for full-width and look-alike letters', () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        const { field, confirm } = openGate({ wipe });
        for (const value of ['ＷＩＰＥ', 'WІPE', 'WIP E']) {
            fireEvent.change(field, { target: { value } });
            expect(confirm.disabled).toBe(true);
        }
        expect(wipe).not.toHaveBeenCalled();
    });
});

describe('wipe with the network down', () => {
    let fetchSpy;
    beforeEach(() => {
        globalThis.localStorage?.clear?.();
        delete globalThis.xchainWalletBridge;
        fetchSpy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        globalThis.fetch = fetchSpy;
        globalThis.indexedDB = {
            deleteDatabase() {
                const req = {};
                queueMicrotask(() => { req.onsuccess?.(); });
                return req;
            },
        };
    });

    it('finishes locally and never calls the network', async () => {
        globalThis.localStorage.setItem('xchain-wallet:vault-meta', '{"v":1}');
        globalThis.localStorage.setItem('xchain.broadcastQueue', '[{"id":"q1","status":"broadcasting"}]');
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
        expect(globalThis.localStorage.getItem('xchain-wallet:vault-meta')).toBeNull();
        expect(globalThis.localStorage.getItem('xchain.broadcastQueue')).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('finishes when the indexer answers 500', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        globalThis.localStorage.setItem('xchain-wallet:vault-meta', '{"v":1}');
        await expect(wipeWalletStorage()).resolves.toBeUndefined();
        expect(globalThis.localStorage.getItem('xchain-wallet:vault-meta')).toBeNull();
    });

    it('keeps the queued broadcast when the shell wipe refuses mid-flight', async () => {
        globalThis.localStorage.setItem('xchain-wallet:vault-meta', '{"v":1}');
        globalThis.localStorage.setItem('xchain.broadcastQueue', '[{"id":"q1","status":"broadcasting"}]');
        globalThis.xchainWalletBridge = { wipeStorage: async () => ({ ok: false, error: 'offline' }) };
        await expect(wipeWalletStorage()).rejects.toThrow();
        expect(globalThis.localStorage.getItem('xchain.broadcastQueue')).not.toBeNull();
    });
});
