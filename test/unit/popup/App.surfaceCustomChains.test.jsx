// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A custom network added or removed in another surface reaches this popup as
// a payload-free `custom-chains` event. The popup re-reads the saved settings,
// makes its own registry match, and forwards the record to the settings hook.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

const CHAIN_ID = 'popup-sibling-fork-regtest';

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    const registry = registryLib.defaultRegistry();
    if (registry.has(CHAIN_ID)) registry.removeCustom(CHAIN_ID);
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

function boot(getSaved) {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    const listeners = new Set();
    const sent = [];
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message.type);
                if (message.type === 'session.status') callback({ ok: true, result: { state: 'unlocked' } });
                else if (message.type === 'wallet.list') callback({ ok: true, result: [{ id: 'w1', name: 'Alpha' }] });
                else if (message.type === 'account.list') {
                    callback({ ok: true, result: [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }] });
                } else if (message.type === 'settings.get') {
                    const record = getSaved();
                    callback(record ? { ok: true, result: record } : { ok: false, error: { name: 'Error', message: 'locked' } });
                }
                else callback({ ok: false, error: { name: 'Error', message: 'not available' } });
            }),
        },
        storage: {
            onChanged: {
                addListener: (listener) => listeners.add(listener),
                removeListener: (listener) => listeners.delete(listener),
            },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
    const emit = (kind, payload = {}) => act(async () => {
        for (const listener of listeners) {
            listener({
                [SURFACE_STATE_STORAGE_KEY]: { newValue: { kind, payload, revision: String(Math.random()) } },
            }, 'session');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { sent, emit };
}

describe('a custom-chains event from another surface', () => {
    it('installs an added network, forwards the record, then drops it when removed', async () => {
        const registry = registryLib.defaultRegistry();
        const descriptor = { ...registry.get('bitcoin-regtest'), id: CHAIN_ID, displayName: 'Popup sibling fork' };
        delete descriptor.isUserAdded;
        let saved = { customChains: [descriptor] };
        const { sent, emit } = boot(() => saved);
        localStorage.setItem('xchain.activeWallet', 'w1');
        localStorage.setItem('xc:activeAccount:w1', 'a1');
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
        const heading = screen.getByRole('heading', { name: 'Home', level: 1 });
        const heard = vi.fn();
        window.addEventListener('xc:settings-changed', heard);

        const readsBefore = sent.filter((type) => type === 'settings.get').length;
        await emit('custom-chains');
        await waitFor(() => expect(registry.has(CHAIN_ID)).toBe(true));
        expect(sent.filter((type) => type === 'settings.get').length).toBeGreaterThan(readsBefore);
        expect(heard).toHaveBeenCalled();
        expect(heard.mock.calls.at(-1)[0].detail.customChains).toHaveLength(1);
        // An addition changes no chain an open screen holds, so it stays mounted.
        expect(heading.isConnected).toBe(true);

        saved = { customChains: [] };
        await emit('custom-chains');
        await waitFor(() => expect(registry.has(CHAIN_ID)).toBe(false));
        await waitFor(() => expect(heading.isConnected).toBe(false));
        expect(heard.mock.calls.at(-1)[0].detail.customChains).toEqual([]);
        window.removeEventListener('xc:settings-changed', heard);
    });

    it('changes nothing when the settings read fails', async () => {
        const registry = registryLib.defaultRegistry();
        const descriptor = { ...registry.get('bitcoin-regtest'), id: CHAIN_ID, displayName: 'Popup sibling fork' };
        delete descriptor.isUserAdded;
        const { emit } = boot(() => null);
        localStorage.setItem('xchain.activeWallet', 'w1');
        localStorage.setItem('xc:activeAccount:w1', 'a1');
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
        await emit('custom-chains');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
        expect(registry.has(CHAIN_ID)).toBe(false);
    });
});
