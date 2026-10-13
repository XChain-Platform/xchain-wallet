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
import {
    AdvancedActionsForm,
    dedicatedFormActions,
} from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import {
    BTC_EXCLUSIVE_ACTIONS,
    COMMON_ACTIONS,
    PROTOCOL_ONLY_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';

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

afterEach(() => cleanup());

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
    it('labels a registry action with a form and leaves an SDK-only action bare', async () => {
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
        const option = (value) => document.querySelector(`option[value="${value}"]`);
        await waitFor(() => expect(option('SDKONLY')).toBeTruthy());
        expect(option('CALLBACK').textContent).toContain(LABEL);
        expect(option('SLEEP').textContent).toContain(LABEL);
        expect(option('SDKONLY').textContent).not.toContain(LABEL);
        expect(screen.getAllByRole('option').length).toBeGreaterThan(3);
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

        await waitFor(() => expect(document.querySelector('option[value="COLLECT"]')).toBeTruthy());
        const collect = document.querySelector('option[value="COLLECT"]');
        const actionPicker = collect.closest('select');
        fireEvent.change(actionPicker, { target: { value: 'COLLECT' } });
        await waitFor(() => expect(target.getActionFormats).toHaveBeenCalledWith({
            chainId: BTC,
            action: 'COLLECT',
        }));

        fireEvent.click(screen.getByRole('button', { name: /Network: Bitcoin/i }));
        fireEvent.click(await screen.findByRole('option', { name: /Litecoin/i }));

        await waitFor(() => expect(target.listActions).toHaveBeenCalledWith({ chainId: LTC }));
        expect(actionPicker.value).toBe('');
        expect(document.querySelector('option[value="COLLECT"]')).toBeNull();
        expect(target.getActionFormats).not.toHaveBeenCalledWith({
            chainId: LTC,
            action: 'COLLECT',
        });
    });

    it('refuses the advanced broadcast surface in signer mode with a reason', async () => {
        const target = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'signer' }),
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
});
