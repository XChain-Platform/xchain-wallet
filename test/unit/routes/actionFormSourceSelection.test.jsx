// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / D-57: every form built on `useActionForm` (MINT, SWEEP,
// DESTROY, SLEEP, CALLBACK, ORACLE, CREATE ORDER, address preferences)
// used to default its SOURCE to the newest HD external address, while
// Home, Send and every `preferredSourceId` form operate on the chain's
// ACTIVE address. On a wallet whose active address is not the highest
// derivation index - the ordinary case once Receive has handed out a
// second address, and the case a FreeWallet migration lands in - Mint
// and the free-entry Sweep opened pointing at an address holding
// nothing, next to a funded one. The user either notices and re-picks,
// or walks into an insufficient-funds path on a wallet that is not
// short of funds.
//
// These drive the real components through the real hook rather than
// asserting on `preferredSourceId` in isolation, because the defect was
// never in the helper: it was the hook not calling it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';

const CHAIN = 'bitcoin-mainnet';

// Two HD external addresses on one chain. #2 is the newest by derivation
// index, so it is what the old "newest HD external" rule picked; #1 is
// the one the wallet is actually operating on (and, in the campaign's
// wallet, the one holding every coin and token).
const ADDR_ACTIVE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qactiveactiveactiveactiveactiveactive0',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const ADDR_NEWEST = Object.freeze({
    id: 'addr-2',
    address: 'bc1qnewestnewestnewestnewestnewestnewest0',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    signerId: 'signer-1',
});
const ADDRESSES = Object.freeze({ [CHAIN]: [ADDR_ACTIVE, ADDR_NEWEST] });

// Permissive host: the calls these two forms make on load get real
// shapes; everything else resolves to something iterable so the loaded
// branch settles instead of hanging on the "Loading…" placeholder.
function mountWith({ Form, props = {}, overrides = {} }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...ADDRESSES }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDR_ACTIVE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        sweepPreview: () => Promise.resolve({ rows: [], gatedTicks: { rows: [] } }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
    return messaging;
}

/** The read-only "From" field's rendered value once the form has loaded. */
async function fromValue() {
    const field = await screen.findByLabelText('From');
    await waitFor(() => expect(field.value).toBeTruthy());
    return field.value;
}

afterEach(() => cleanup());

describe('useActionForm source default ( / D-57)', () => {
    it('MintForm opens on the chain ACTIVE address, not the newest HD address', async () => {
        const messaging = mountWith({ Form: MintForm });
        expect(await fromValue()).toBe(ADDR_ACTIVE.address);
        expect(messaging.getActiveAddresses).toHaveBeenCalledWith('w');
    });

    it('SweepForm opens on the chain ACTIVE address', async () => {
        mountWith({ Form: SweepForm });
        expect(await fromValue()).toBe(ADDR_ACTIVE.address);
    });

    it('matches the active entry by address string when it carries no id', async () => {
        mountWith({
            Form: MintForm,
            overrides: {
                getActiveAddresses: vi.fn().mockResolvedValue({
                    [CHAIN]: { address: ADDR_ACTIVE.address },
                }),
            },
        });
        expect(await fromValue()).toBe(ADDR_ACTIVE.address);
    });

    it('falls back to the newest HD external address when no active address applies', async () => {
        mountWith({
            Form: MintForm,
            overrides: { getActiveAddresses: vi.fn().mockResolvedValue({}) },
        });
        expect(await fromValue()).toBe(ADDR_NEWEST.address);
    });

    it('falls back when the active address is not one of this chain\'s addresses', async () => {
        mountWith({
            Form: MintForm,
            overrides: {
                getActiveAddresses: vi.fn().mockResolvedValue({
                    [CHAIN]: { id: 'addr-from-another-wallet' },
                }),
            },
        });
        expect(await fromValue()).toBe(ADDR_NEWEST.address);
    });

    it('an explicit initialFromAddress still wins over the active address', async () => {
        // Owner-gated contexts (ManageToken's per-token actions) resolve the
        // source themselves; the active-address preference must not clobber it.
        mountWith({
            Form: MintForm,
            props: { initialFromAddress: ADDR_NEWEST.address },
        });
        expect(await fromValue()).toBe(ADDR_NEWEST.address);
    });

    it('still resolves a source when the host has no getActiveAddresses at all', async () => {
        // Older/limited hosts (and the bridge shells) may not implement it;
        // the form must degrade to the HD rule, never to an empty From.
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ ...ADDRESSES }),
            signerReady: () => Promise.resolve({ ready: true }),
            getSettings: () => Promise.resolve({ walletMode: 'full' }),
            getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
            getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        };
        const messaging = new Proxy(target, {
            get(t, prop) {
                if (prop in t) return t[prop];
                if (prop === 'getActiveAddresses') return undefined;
                return () => Promise.resolve({ rows: [] });
            },
            has: (t, prop) => (prop === 'getActiveAddresses' ? false : prop in t),
        });
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(MintForm, { walletId: 'w', onBack() {} }),
            ),
        );
        expect(await fromValue()).toBe(ADDR_NEWEST.address);
    });

    it('a rejected getActiveAddresses degrades to the HD rule instead of failing the load', async () => {
        mountWith({
            Form: MintForm,
            overrides: {
                getActiveAddresses: vi.fn().mockRejectedValue(new Error('host down')),
            },
        });
        expect(await fromValue()).toBe(ADDR_NEWEST.address);
        expect(screen.queryByText(/host down/)).toBeNull();
    });
});
