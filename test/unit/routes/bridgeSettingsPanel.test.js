// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The issuer's bridgeability panel (ISSUE format 7). Every case here is about
// something an issuer cannot take back: opening a token to another chain, the
// depth they price a reorg at, and the one-way freeze. The policy refusal is
// the other half: a token bound to an address list can never be bridged in
// milestone 1, and a bound list can never be cleared, so a wallet that let an
// issuer try would be selling a door that does not open.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const DOGE = 'dogecoin-mainnet';
const DOGE_ADDRESS = {
    id: 'a-doge', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx', publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd',
};
const WAIT = { timeout: 4000 };

function mountAdmin(tokenInfo) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = new Proxy(base, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            t[p] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenAdminForm, {
            walletId: 'w',
            mode: 'bridge-settings',
            initialChainId: DOGE,
            initialTick: 'FUFU',
            onBack() {},
        }),
    ));
    return messaging;
}

const applyButton = () => screen.getByRole('button', { name: /Bridge settings|Sign|Apply|Update/i });

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

describe('TokenAdminForm bridge settings: the opt-in', () => {
    it('offers every chain but the one the token is native to, unchecked by default', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        await waitFor(() => expect(screen.getByText('Destination chains')).toBeInTheDocument(), WAIT);
        expect(screen.getByLabelText('Bitcoin')).not.toBeChecked();
        expect(screen.getByLabelText('Litecoin')).not.toBeChecked();
        expect(screen.queryByLabelText('Dogecoin')).toBeNull();
    });

    it('pre-fills the chains the issuer already opted in to', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'BTC',
        });
        await waitFor(() => expect(screen.getByLabelText('Bitcoin')).toBeChecked(), WAIT);
        expect(screen.getByLabelText('Litecoin')).not.toBeChecked();
    });

    it('says plainly that closing a chain never strands existing holders', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const note = await screen.findByText(/closes the door to NEW transfers/i, {}, WAIT);
        expect(note.textContent).toContain('holders can still bring those');
    });
});

describe('TokenAdminForm bridge settings: refusals the issuer cannot undo', () => {
    it('refuses to open a list-bound token, and says why it stays refused', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, allowList: '1234',
        });
        const msg = await screen.findByText(/bound to an address list/i, {}, WAIT);
        expect(msg.textContent).toContain('would carry none of that policy on the other chain');
        expect(msg.textContent).toContain('can never be cleared');
        expect(screen.getByLabelText('Bitcoin')).toBeDisabled();
    });

    it('refuses every change once the settings are frozen', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'BTC', lockBridge: true,
        });
        const msg = await screen.findByText(/frozen for good/i, {}, WAIT);
        expect(msg).toBeInTheDocument();
        expect(screen.getByLabelText('Bitcoin')).toBeDisabled();
        expect(screen.getByLabelText(/Minimum confirmations/i)).toBeDisabled();
        // And there is no freeze checkbox to re-apply.
        expect(screen.queryByLabelText(/Freeze these settings/i)).toBeNull();
    });

    it('warns that the freeze is one-way before it is signed', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        await waitFor(() => expect(screen.getByLabelText(/Freeze these settings/i)).toBeInTheDocument(), WAIT);
        fireEvent.click(screen.getByLabelText(/Freeze these settings/i));
        const msg = await screen.findByText(/Freezing is one-way/i, {}, WAIT);
        expect(msg.textContent).toContain('by you or by a future owner');
    });

    it('does not pre-fill, and says so, when the venue reports no bridge field', async () => {
        // An absent field is NOT an opt-out: back-filling unchecked boxes as if
        // it were would let an issuer "confirm" a setting they never made.
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const note = await screen.findByText(/does not report the token's current bridge setting/i, {}, WAIT);
        expect(note.textContent).toContain('nothing below is pre-filled');
    });
});

describe('IssueTokenForm: the bridgeability disclosure', () => {
    it('says bridging is off, where it is turned on, and the list decision that is final', async () => {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        };
        const messaging = new Proxy(base, {
            get(t, p) {
                if (p in t) return t[p];
                if (typeof p !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                t[p] = stub;
                return stub;
            },
        });
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(IssueTokenForm, { walletId: 'w', onBack() {} }),
        ));
        const note = await screen.findByText(/Bridging is off/i, {}, WAIT);
        expect(note.textContent).toContain('Manage Token');
        const listNote = screen.getByText(/cannot be bridged, and a bound list can never be cleared/i);
        expect(listNote).toBeInTheDocument();
    });
});
