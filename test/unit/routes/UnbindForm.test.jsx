// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unbind Controller is its own form, separate from Bind Controller. These
// cases pin its Form Standard layout, its route and entry points, the address
// subject's compose, the refusals that must stop before anything is built,
// and the watcher lane that builds the unbind unsigned.

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnbindForm } from '../../../packages/core/src/shared/routes/UnbindForm.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const HD = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qdevmock02aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function makeMessaging(overrides = {}) {
    const calls = [];
    const record = (method) => (args) => {
        calls.push({ method, args });
        return Promise.resolve({ txid: `tx-${method}` });
    };
    const messaging = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({}),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getOwnedTokens: () => Promise.resolve([{ tick: 'JDOG' }]),
        getTokenInfo: ({ tick } = {}) => Promise.resolve({ chainId: CHAIN, tick, creator: HD.address, locks: {} }),
        getControllerActionClasses: () => Promise.resolve({
            actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
        }),
        buildControllerBindParams: (args) => {
            calls.push({ method: 'buildControllerBindParams', args });
            return Promise.resolve({
                action: args.target === 'token' ? 'ISSUE' : 'ADDRESS',
                params: { VERSION: args.target === 'token' ? '6' : '1', ACTION_CLASS: args.actionClass, UNBIND: '1' },
            });
        },
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
        },
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        buildActionPsbtRequest: (args) => {
            calls.push({ method: 'buildActionPsbtRequest', args });
            return Promise.resolve({ psbtHex: 'aa00', encoding: 'psbt', fromAddress: HD.address, chainId: CHAIN });
        },
        advancedAction: record('advancedAction'),
        ...overrides,
    };
    return { messaging, calls };
}

async function mount(props = {}, overrides = {}) {
    const { messaging, calls } = makeMessaging(overrides);
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <UnbindForm walletId="w" chainId={CHAIN} onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
    });
    return { utils, calls };
}

const unbindButton = (utils) => utils.getByRole('button', { name: 'Unbind' });
const built = (calls) => calls.filter((c) => c.method === 'buildControllerBindParams'
    || c.method === 'composeForConfirm'
    || c.method === 'buildActionPsbtRequest');

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    resetWalletModes();
});

describe('Unbind Controller form', () => {
    it('renders on the Form Standard: From, the Controller section, Memo, Network fee and an Unbind action with an icon', async () => {
        const { utils } = await mount({ tick: 'JDOG' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByRole('heading', { name: 'Unbind Controller' })).toBeTruthy();
        const toggles = Array.from(utils.container.querySelectorAll('[data-form-section-toggle]'));
        const titles = toggles.map((b) => (b.querySelector('[data-form-section-title]')?.textContent || '').trim());
        expect(titles[0]).toMatch(/^From/);
        expect(titles[1]).toMatch(/^Controller/);
        expect(titles[2]).toMatch(/^Memo/);
        expect(titles[titles.length - 1]).toMatch(/^Network fee/);
        // The main section starts open; From, Memo and the fee start closed.
        expect(toggles[1].getAttribute('aria-expanded')).toBe('true');
        expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
        expect(toggles[2].getAttribute('aria-expanded')).toBe('false');
        // What is being unbound: the token, the controller and its class.
        expect(utils.getByLabelText(/^What to unbind/)).toBeTruthy();
        expect(utils.getByLabelText(/^Action class/)).toBeTruthy();
        expect(utils.getByTestId('unbind-controller').textContent).toMatch(/no contract number is needed/);
        // Bind-only fields never appear on an unbind.
        expect(utils.queryByLabelText(/Guard contract/)).toBeNull();
        expect(utils.queryByLabelText(/Cooldown/)).toBeNull();
        expect(unbindButton(utils).querySelector('svg')).not.toBeNull();
    });

    it('shows a known bound controller for reference and opens on its class', async () => {
        const { utils } = await mount({ tick: 'JDOG', controller: '42', actionClass: 'trade' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByTestId('unbind-controller').textContent).toBe('Guard contract #42');
        expect(utils.getByLabelText(/^Action class/).value).toBe('trade');
    });

    it('composes an address unbind (ADDRESS) with an empty controller and the chosen class', async () => {
        const { utils, calls } = await mount({ target: 'address' }, { getOwnedTokens: () => Promise.resolve([]) });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByTestId('unbind-address-subject').textContent).toContain('From address');
        fireEvent.change(utils.getByLabelText(/^Action class/), { target: { value: 'burn' } });
        await act(async () => { fireEvent.click(unbindButton(utils)); });
        await waitFor(() => expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(true));
        const request = calls.find((c) => c.method === 'buildControllerBindParams').args;
        expect(request).toMatchObject({ target: 'address', unbind: true, actionClass: 'burn', controller: '' });
        expect(request.tick).toBeUndefined();
        const compose = calls.find((c) => c.method === 'composeForConfirm').args;
        expect(compose.actionData.action).toBe('ADDRESS');
    });

    it('refuses a memo with a field delimiter and builds nothing', async () => {
        const { utils, calls } = await mount({ tick: 'JDOG' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        fireEvent.change(utils.getByLabelText(/^Memo/), { target: { value: 'bad|memo' } });
        await act(async () => { fireEvent.click(unbindButton(utils)); });
        expect(utils.getByText('Memo cannot contain | or ; characters.')).toBeTruthy();
        expect(built(calls)).toEqual([]);
    });

    it('refuses a token this wallet does not own and builds nothing', async () => {
        const { utils, calls } = await mount({ tick: 'JDOG' }, {
            getTokenInfo: ({ tick } = {}) => Promise.resolve({ chainId: CHAIN, tick, creator: 'bc1qsomeoneelse00', locks: {} }),
        });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        await waitFor(async () => {
            await act(async () => { fireEvent.click(unbindButton(utils)); });
            expect(utils.getByText('This wallet does not own JDOG. Only the current owner can make this change.')).toBeTruthy();
        });
        expect(built(calls)).toEqual([]);
    });

    it('offers only the switch away on a network with no address to sign from', async () => {
        const { utils, calls } = await mount({}, {
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [{ ...HD, source: 'xpub-watch' }] }),
        });
        await waitFor(() => expect(utils.getByText(/No address on this network to sign from/)).toBeTruthy());
        expect(unbindButton(utils).disabled).toBe(true);
        expect(built(calls)).toEqual([]);
    });

    it('holds a watch-only source in a full wallet and builds nothing', async () => {
        const { utils, calls } = await mount({ target: 'address' }, {
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [{ ...HD, source: 'watch-only', derivationPath: null }] }),
            getOwnedTokens: () => Promise.resolve([]),
        });
        await waitFor(() => expect(utils.getByText(/watch-only/i)).toBeTruthy());
        expect(unbindButton(utils).disabled).toBe(true);
        await act(async () => { fireEvent.submit(unbindButton(utils).closest('form')); });
        expect(built(calls)).toEqual([]);
    });

    it('builds the unbind unsigned in watcher mode, never signing it', async () => {
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        const { utils, calls } = await mount({ target: 'address' }, {
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [{ ...HD, source: 'watch-only', derivationPath: null }] }),
            getOwnedTokens: () => Promise.resolve([]),
        });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        await act(async () => { fireEvent.click(unbindButton(utils)); });
        await waitFor(() => expect(calls.some((c) => c.method === 'buildActionPsbtRequest')).toBe(true));
        expect(calls.find((c) => c.method === 'buildControllerBindParams').args.unbind).toBe(true);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(calls.some((c) => c.method === 'advancedAction')).toBe(false);
    });
});

describe('Unbind Controller route and entry points', () => {
    it('is registered as its own route beside Bind Controller', () => {
        expect(ROUTE_REGISTRY['controller-unbind']).toMatchObject({ component: 'UnbindForm' });
        expect(ROUTE_REGISTRY['controller-bind']).toMatchObject({ component: 'ControllerBindForm' });
    });

    it('has a palette command that opens the form', () => {
        const navigate = vi.fn();
        const cmd = buildCommands({ navigate }).find((c) => c.id === 'create-controller-unbind');
        expect(cmd, 'no palette command opens Unbind').toBeTruthy();
        cmd.run();
        expect(navigate).toHaveBeenCalledWith('controller-unbind');
        const haystack = `${cmd.title} ${cmd.subtitle} ${(cmd.keywords || []).join(' ')}`.toLowerCase();
        for (const word of ['unbind', 'controller', 'guard']) expect(haystack).toContain(word);
    });

    it('renders with no tick and no chain, defaulting the chain itself', async () => {
        const { utils } = await mount({ chainId: undefined }, { getOwnedTokens: () => Promise.resolve([]) });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByLabelText(/^What to unbind/).value).toBe('address');
    });
});
