// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Signer mode PROMISES a removed capability, so the promise is
// what gets tested.
//
// The Wallet Mode settings screen says, when the user picks Signer:
// "Sign transactions pasted in from a watcher wallet. Send / receive
// screens are hidden; this wallet does not broadcast." That sentence is
// the same class as the Tor toggle in - it is not a description of
// a preference, it is a statement about what the wallet will no longer
// do, made on the screen where a user deliberately chooses to be safe.
// An air-gapped-signer user who believes send is gone may treat the
// device as one that cannot spend.
//
// Before this, the mode was PARTIALLY applied: it persisted, and Home
// really did become the signer surface, but `LeftNav` built its primary
// array with no wallet-mode gating and `Send.jsx` refused on nothing. So
// both screens stayed one click away.
//
// Four reachability paths are pinned here, because gating any one of them
// alone leaves the promise broken through the others:
//   1. the left nav rail (desktop / wide web),
//   2. the bottom tab bar (below 600px - the likeliest signer device),
//   3. the command palette (Cmd/Ctrl+K reaches every route by name),
//   4. the routes themselves (a `xchain:` URI intent and a restored view
//      state both mount Send / Receive without a nav click).
//
// The positive cases matter as much as the negative ones: a gate that
// removed Send from every wallet would also make this file green.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const navProps = { currentView: 'home', onSelect: () => {} };

function navButtonLabels() {
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    return [...nav.querySelectorAll('button')].map((b) => b.textContent.trim());
}

describe('LeftNav: the primary rail honours signer mode', () => {
    it('offers Send and Receive in the default (full) mode', () => {
        render(<LeftNav {...navProps} />);
        expect(navButtonLabels()).toContain('Send');
        expect(navButtonLabels()).toContain('Receive');
    });

    it('offers NEITHER once the wallet is a signer', () => {
        render(<LeftNav {...navProps} isSignerMode />);
        const labels = navButtonLabels();
        expect(labels).not.toContain('Send');
        expect(labels).not.toContain('Receive');
        // Absent, not disabled: a greyed row still reads as a capability
        // the device has, which is the thing the hint denies.
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
        // The rest of the rail is untouched - this is a two-row removal,
        // not a stripped nav.
        expect(labels).toContain('Home');
        expect(labels).toContain('History');
        expect(labels).toContain('Scan');
        expect(labels).toContain('Messaging');
    });
});

describe('BottomTabBar: the thumb row honours signer mode', () => {
    it('offers Send in the tab row and Receive in the More sheet by default', () => {
        render(<BottomTabBar {...navProps} />);
        expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /More/ }));
        expect(screen.getByRole('button', { name: /Receive/ })).toBeInTheDocument();
    });

    it('offers neither once the wallet is a signer', () => {
        render(<BottomTabBar {...navProps} isSignerMode />);
        expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
        // Receive lives behind "More", so the sheet has to be opened before
        // its absence means anything.
        fireEvent.click(screen.getByRole('button', { name: /More/ }));
        expect(screen.queryByRole('button', { name: /Receive/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
    });
});

describe('command palette: Cmd/Ctrl+K cannot walk around the mode', () => {
    const ids = (ctx) => buildCommands({ navigate: () => {}, ...ctx }).map((c) => c.id);

    it('lists nav-send and nav-receive by default', () => {
        expect(ids({})).toEqual(expect.arrayContaining(['nav-send', 'nav-receive']));
    });

    it('lists neither in signer mode, and keeps every other Navigate row', () => {
        const signer = ids({ isSignerMode: true });
        expect(signer).not.toContain('nav-send');
        expect(signer).not.toContain('nav-receive');
        expect(signer).toEqual(expect.arrayContaining(['nav-home', 'nav-history', 'nav-messaging']));
    });
});

// --- the routes themselves ------------------------------------------------
//
// A nav-only gate would still leave both screens reachable: the web shell
// routes a `xchain:` send intent straight to `unlockedView = 'send'`, and
// `useLastView` restores whatever view the wallet was on when it locked.

const CHAIN = 'litecoin-mainnet';
const ADDRESS = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';

/** Messaging stub broad enough for either route; unknown calls resolve null. */
function messagingFor(walletMode) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-1', address: ADDRESS } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode, grace: { testSendThresholdSats: 0 } }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function mount(Route, walletMode) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingFor(walletMode) },
            React.createElement(Route, { walletId: 'w', onBack() {} }),
        ),
    );
}

describe('Send: the route refuses in signer mode', () => {
    it('renders the compose form in full mode', async () => {
        mount(Send, 'full');
        await waitFor(() => expect(screen.getByLabelText(/^To$/)).toBeInTheDocument());
    });

    it('refuses, and says why and how to undo it, in signer mode', async () => {
        mount(Send, 'signer');
        expect(await screen.findByText(/signer mode, so it does not send or broadcast/i))
            .toBeInTheDocument();
        // The form must be GONE, not merely covered: the To field is the one
        // input a URI intent would have pre-filled.
        expect(screen.queryByLabelText(/^To$/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
    });
});

describe('Receive: the route refuses in signer mode', () => {
    it('renders the receive surface in full mode', async () => {
        mount(Receive, 'full');
        await waitFor(() => expect(screen.getByText('Receive')).toBeInTheDocument());
        expect(screen.queryByText(/receive screen is hidden/i)).toBeNull();
    });

    it('refuses in signer mode', async () => {
        mount(Receive, 'signer');
        expect(await screen.findByText(/signer mode, so its receive screen is hidden/i))
            .toBeInTheDocument();
    });
});
