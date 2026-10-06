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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
