// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Advanced Actions "(dedicated form available)" label comes from the
// registry's authorable set, so every action with a form carries it and an
// action the SDK lists without a form does not.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import {
    AdvancedActionsForm,
    dedicatedFormActions,
} from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import {
    BTC_EXCLUSIVE_ACTIONS,
    COMMON_ACTIONS,
    PROTOCOL_ONLY_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';
import { openSelectListbox, selectOption, selectOptionDetails, selectOptionValues } from '../../helpers/selectOption.js';

const LABEL = '(dedicated form available)';
const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const FROM = {
    id: 'bc-0',
    address: 'bc1qdedicatedformsaddress000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

afterEach(() => { cleanup(); resetWalletModes(); });

describe('dedicatedFormActions', () => {
    const real = dedicatedFormActions({
        authorable: [...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS],
        protocolOnly: PROTOCOL_ONLY_ACTIONS,
    });

    it('marks the forms the old hand-kept list had fallen behind on', () => {
        for (const a of ['SEND', 'SWEEP', 'PRICE', 'CALLBACK', 'SLEEP', 'XBRIDGE', 'BATCH', 'COINPAY', 'DEPLOY']) {
            expect(real.has(a)).toBe(true);
        }
    });

    it('covers exactly the authorable set while no action is protocol-only', () => {
        expect([...real].sort()).toEqual([...new Set([...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS])].sort());
    });

    it('drops a protocol-only action even when it is also listed as authorable', () => {
        const set = dedicatedFormActions({ authorable: ['SEND', 'PLUMBING'], protocolOnly: ['PLUMBING'] });
        expect([...set]).toEqual(['SEND']);
    });
});

describe('AdvancedActionsForm action picker label', () => {
    it('gives every action option an icon and prints no dedicated-form text', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            listActions: vi.fn().mockResolvedValue(['CALLBACK', 'SLEEP', 'SDKONLY']),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        const picker = await screen.findByRole('combobox', { name: 'Action' });
        await waitFor(() => expect(selectOptionValues(picker)).toContain('SDKONLY'));
        const details = selectOptionDetails(picker);
        const option = (value) => details.find((o) => o.value === value);
        for (const o of details) expect(o.label).not.toContain(LABEL);
        expect(option('SDKONLY')).toBeTruthy();
        expect(details.length).toBeGreaterThan(3);
        // Every option, the placeholder included, carries an icon.
        const listbox = openSelectListbox(picker);
        const rows = Array.from(listbox.querySelectorAll('[role="option"]'));
        expect(rows.length).toBe(details.length);
        for (const row of rows) expect(row.querySelector('svg')).not.toBeNull();
        expect(listbox.textContent).not.toMatch(/dedicated form/i);
    });

    it('clears a chain-specific action before loading the next network', async () => {
        const litecoinFrom = { ...FROM, id: 'ltc-0', address: 'ltc1qadvancedactionsaddress000000000000000' };
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [BTC]: [FROM],
                [LTC]: [litecoinFrom],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [BTC]: FROM,
                [LTC]: litecoinFrom,
            }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            listActions: vi.fn(async ({ chainId }) => chainId === BTC
                ? ['COLLECT', 'SEND']
                : ['SEND']),
            getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION' }),
            getActionFields: vi.fn().mockResolvedValue(['VERSION']),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const actionPicker = await screen.findByRole('combobox', { name: 'Action' });
        await waitFor(() => expect(selectOptionValues(actionPicker)).toContain('COLLECT'));
        selectOption(actionPicker, 'COLLECT');
        await waitFor(() => expect(target.getActionFormats).toHaveBeenCalledWith({
            chainId: BTC,
            action: 'COLLECT',
        }));

        // Network sits in the closed From section; open it to reach the network picker.
        fireEvent.click(screen.getByRole('button', { name: /^From\b/, expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: /Network: Bitcoin/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Select Litecoin/i }));

        await waitFor(() => expect(target.listActions).toHaveBeenCalledWith({ chainId: LTC }));
        const nextPicker = screen.getByRole('combobox', { name: 'Action' });
        expect(nextPicker.value).toBe('');
        expect(selectOptionValues(nextPicker)).not.toContain('COLLECT');
        expect(target.getActionFormats).not.toHaveBeenCalledWith({
            chainId: LTC,
            action: 'COLLECT',
        });
    });

    it('refuses the advanced broadcast surface in signer mode with a reason', async () => {
        // The wallet's mode is read from the wallet list, not from settings.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'signer' }], activeWalletId: 'w' });
        const target = {
            getSettings: vi.fn().mockResolvedValue({}),
            listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'signer' }]),
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            listActions: vi.fn().mockResolvedValue(['SEND']),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText(/Advanced action is unavailable/)).toBeTruthy();
        expect(screen.queryByRole('combobox', { name: 'Action' })).toBeNull();
    });

    it('keeps submit disabled until a slow action schema is fully loaded', async () => {
        const formats = deferred();
        const fields = deferred();
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['SDKONLY']),
            getActionFormats: vi.fn(() => formats.promise),
            getActionFields: vi.fn(() => fields.promise),
            composeForConfirm: vi.fn(),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const actionPicker = await screen.findByRole('combobox', { name: 'Action' });
        await waitFor(() => expect(selectOptionValues(actionPicker)).toContain('SDKONLY'));
        selectOption(actionPicker, 'SDKONLY');

        expect(screen.getByRole('button', { name: 'Sign Action' })).toBeDisabled();
        expect(screen.queryByText('This action takes no user-provided fields.')).toBeNull();
        expect(target.composeForConfirm).not.toHaveBeenCalled();

        formats.resolve({ 0: 'VERSION|VALUE' });
        fields.resolve(['VERSION', 'VALUE']);
        expect(await screen.findByLabelText('VALUE')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Action' })).toBeEnabled();
    });

    it('keeps submit disabled when an action schema fails to load', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['SDKONLY']),
            getActionFormats: vi.fn().mockRejectedValue(new Error('schema unavailable')),
            getActionFields: vi.fn().mockResolvedValue(['VERSION', 'VALUE']),
            composeForConfirm: vi.fn(),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const actionPicker = await screen.findByRole('combobox', { name: 'Action' });
        await waitFor(() => expect(selectOptionValues(actionPicker)).toContain('SDKONLY'));
        selectOption(actionPicker, 'SDKONLY');

        expect(await screen.findByText('schema unavailable')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Action' })).toBeDisabled();
        expect(target.composeForConfirm).not.toHaveBeenCalled();
    });

    it('clears a schema load error when another action is picked', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['BADONE', 'GOODONE']),
            getActionFormats: vi.fn(({ action }) => (action === 'BADONE'
                ? Promise.reject(new Error('schema unavailable'))
                : Promise.resolve({ 0: 'VERSION|VALUE' }))),
            getActionFields: vi.fn().mockResolvedValue(['VERSION', 'VALUE']),
            composeForConfirm: vi.fn(),
        };
        const messaging = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AdvancedActionsForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );

        const actionPicker = await screen.findByRole('combobox', { name: 'Action' });
        await waitFor(() => expect(selectOptionValues(actionPicker)).toContain('GOODONE'));
        selectOption(actionPicker, 'BADONE');
        expect(await screen.findByText('schema unavailable')).toBeInTheDocument();
        selectOption(actionPicker, 'GOODONE');
        expect(await screen.findByLabelText('VALUE')).toBeInTheDocument();
        expect(screen.queryByText('schema unavailable')).toBeNull();
    });
});
