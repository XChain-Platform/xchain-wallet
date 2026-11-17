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
import { openSelectListbox, selectOption } from '../../helpers/selectOption.js';
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
    it('renders on the Form Standard: From, the Controller section, Memo, Fees and an Unbind action with an icon', async () => {
        const { utils } = await mount({ tick: 'JDOG' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByRole('heading', { name: 'Unbind Controller' })).toBeTruthy();
        const toggles = Array.from(utils.container.querySelectorAll('[data-form-section-toggle]'));
        const titles = toggles.map((b) => (b.querySelector('[data-form-section-title]')?.textContent || '').trim());
        expect(titles[0]).toMatch(/^From/);
        expect(titles[1]).toMatch(/^Controller/);
        expect(titles[2]).toMatch(/^Memo/);
        expect(titles[titles.length - 1]).toBe('Speed and Fees');
        // The main section starts open; From, Memo and the fee start closed.
        expect(toggles[1].getAttribute('aria-expanded')).toBe('true');
        expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
        expect(toggles[2].getAttribute('aria-expanded')).toBe('false');
        // What is being unbound: the token, the controller and its class.
        expect(utils.getByLabelText(/^What to unbind/)).toBeTruthy();
        expect(utils.getByLabelText(/^Action class/)).toBeTruthy();
        // No explainer lines under the fields (operator 2026-11-13).
        expect(utils.queryByTestId('unbind-controller')).toBeNull();
        expect(utils.queryByText(/no contract number is needed/)).toBeNull();
        // Bind-only fields never appear on an unbind.
        expect(utils.queryByLabelText(/Guard contract/)).toBeNull();
        expect(utils.queryByLabelText(/Cooldown/)).toBeNull();
        expect(unbindButton(utils).querySelector('svg')).not.toBeNull();
    });

    it('opens on the class of a known bound controller', async () => {
        const { utils } = await mount({ tick: 'JDOG', controller: '42', actionClass: 'trade' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByLabelText(/^Action class/).value).toBe('trade');
    });

    it('opens the standard token picker on only the owned tokens and returns the pick to the form', async () => {
        const { utils } = await mount({ tick: 'JDOG' }, {
            getOwnedTokens: () => Promise.resolve([{ tick: 'JDOG' }, { tick: 'KEK' }]),
            getWalletBalances: () => Promise.resolve({
                [CHAIN]: [{
                    address: HD.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [
                            { tick: 'JDOG', quantity: '7', divisibility: 0 },
                            { tick: 'NOTMINE', quantity: '3', divisibility: 0 },
                        ],
                    },
                }],
            }),
        });
        const field = await utils.findByRole('button', { name: /^Token: JDOG/ });
        await waitFor(() => expect(field).toBeEnabled());
        expect(utils.getByRole('heading', { name: 'Unbind Controller' })).toBeTruthy();
        fireEvent.click(field);

        // The picker's own title, not the form's.
        expect(await utils.findByRole('heading', { name: 'Select Token' })).toBeTruthy();
        expect(utils.queryByRole('heading', { name: 'Unbind Controller' })).toBeNull();
        const option = (tick) => (name) => name.startsWith(`Select ${tick} on Bitcoin,`);
        // An owned token shows the wallet's own balance of it; one it holds none of shows 0.
        expect(await utils.findByRole('button', { name: option('JDOG') })).toHaveAccessibleName(/, 7 JDOG/);
        expect(utils.getByRole('button', { name: option('KEK') })).toHaveAccessibleName(/, 0 KEK/);
        expect(utils.getAllByRole('button', { name: (name) => name.startsWith('Select ') })).toHaveLength(2);

        fireEvent.click(utils.getByRole('button', { name: option('KEK') }));
        expect(await utils.findByRole('button', { name: /^Token: KEK/ })).toBeTruthy();
        expect(utils.getByRole('heading', { name: 'Unbind Controller' })).toBeTruthy();
    });

    it('composes an address unbind (ADDRESS) with an empty controller and the chosen class', async () => {
        const { utils, calls } = await mount({ target: 'address' }, { getOwnedTokens: () => Promise.resolve([]) });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.queryByTestId('unbind-address-subject')).toBeNull();
        selectOption(utils.getByLabelText(/^Action class/), 'burn');
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

    it('G22: a press with an invalid memo marks the Memo field red and reopens its section', async () => {
        const { utils, calls } = await mount({ tick: 'JDOG' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        fireEvent.change(utils.getByLabelText(/^Memo/), { target: { value: 'bad;memo' } });
        // The action stays enabled with the invalid value; the press is the check.
        expect(unbindButton(utils).disabled).toBe(false);
        await act(async () => { fireEvent.click(unbindButton(utils)); });
        expect(utils.getByLabelText(/^Memo/).getAttribute('aria-invalid')).toBe('true');
        const memoToggle = Array.from(utils.container.querySelectorAll('[data-form-section-toggle]'))
            .find((b) => /^Memo/.test((b.querySelector('[data-form-section-title]')?.textContent || '').trim()));
        expect(memoToggle.getAttribute('aria-expanded')).toBe('true');
        expect(built(calls)).toEqual([]);
    });

    it('G22: holds the action only while the owned tokens are still loading', async () => {
        const { utils } = await mount({ tick: 'JDOG' }, { getOwnedTokens: () => new Promise(() => {}) });
        await waitFor(() => expect(utils.getByRole('button', { name: /^Token/ })).toBeTruthy());
        expect(unbindButton(utils).disabled).toBe(true);
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
        await waitFor(() => expect(utils.getByText(/no key in this wallet/i)).toBeTruthy());
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

    it('gives every What to unbind and Action class option its own icon', async () => {
        const { utils } = await mount({ tick: 'JDOG' });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        const iconsOf = (trigger) => {
            const listbox = openSelectListbox(trigger);
            const rows = Array.from(listbox.querySelectorAll('[role="option"]'));
            const icons = rows.map((o) => [o.getAttribute('data-value'), o.querySelector('svg')?.innerHTML || '']);
            fireEvent.click(trigger);
            return icons;
        };
        const target = iconsOf(utils.getByLabelText(/^What to unbind/));
        expect(target.map(([value]) => value)).toEqual(['token', 'address']);
        for (const [value, svg] of target) expect(svg, `${value} has no icon`).not.toBe('');
        expect(new Set(target.map(([, svg]) => svg)).size).toBe(2);

        const classes = iconsOf(utils.getByLabelText(/^Action class/));
        expect(classes.map(([value]) => value))
            .toEqual(['all', 'burn', 'mint', 'ownership', 'stake', 'trade', 'transfer']);
        for (const [value, svg] of classes) expect(svg, `${value} has no icon`).not.toBe('');
        expect(new Set(classes.map(([, svg]) => svg)).size).toBe(7);
    });

    it('shows no explainer lines under the fields (operator 2026-11-13)', async () => {
        const { utils } = await mount({ target: 'address' }, { getOwnedTokens: () => Promise.resolve([]) });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.queryByText(/comes off the From address/)).toBeNull();
        expect(utils.queryByText(/no contract number is needed/)).toBeNull();
    });

    it('renders with no tick and no chain, defaulting the chain itself', async () => {
        const { utils } = await mount({ chainId: undefined }, { getOwnedTokens: () => Promise.resolve([]) });
        await waitFor(() => expect(unbindButton(utils).disabled).toBe(false));
        expect(utils.getByLabelText(/^What to unbind/).value).toBe('address');
    });
});
