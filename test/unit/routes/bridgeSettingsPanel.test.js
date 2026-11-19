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
// the other half: a token with an active address-list policy cannot bridge
// until the issuer detaches that policy.

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
        // Token settings are owner-only; the DOGE source issued the token.
        getTokenInfo: vi.fn().mockResolvedValue({ creator: DOGE_ADDRESS.address, ...tokenInfo }),
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

const applyButton = () => screen.getByRole('button', { name: 'Update Bridge Settings' });

// G117: the networks are one picker field on the form and switch rows on its
// picker page; a switch writes the choice at once and Back returns to the form.
const networksField = (name = /^Destination networks: /) => screen.findByRole('button', { name }, WAIT);
async function openNetworks() {
    fireEvent.click(await networksField());
    return screen.findByRole('group', { name: 'Destination Networks' }, WAIT);
}
const closeNetworks = () => fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

afterEach(() => { cleanup(); vi.clearAllMocks(); __clearTokenInfoCache(); });

describe('TokenAdminForm bridge settings: the opt-in', () => {
    it('offers every network but the one the token is native to, unchecked by default', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        await networksField('Destination networks: None set');
        await openNetworks();
        expect(screen.getByLabelText('Bitcoin')).not.toBeChecked();
        expect(screen.getByLabelText('Litecoin')).not.toBeChecked();
        expect(screen.queryByLabelText('Dogecoin')).toBeNull();
    });

    it('pre-fills the networks the issuer already opted in to', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'BTC',
        });
        await networksField('Destination networks: Bitcoin');
        await openNetworks();
        expect(screen.getByLabelText('Bitcoin')).toBeChecked();
        expect(screen.getByLabelText('Litecoin')).not.toBeChecked();
    });

    // The network matches the stored list verbatim against an upper-case coin,
    // so a lower-case entry opens nothing and must not read as an open chain.
    it('does not pre-fill a lower-case entry, says it opens nothing, and treats the untouched form as unchanged', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'ltc',
        });
        const note = await screen.findByText(/a spelling the network does not accept/i, {}, WAIT);
        expect(note.textContent).toContain('"ltc"');
        // The field shows only what a lock can reach, never the stored spelling.
        await networksField('Destination networks: None set');
        // G22: unchanged, Apply stays enabled and a press says what to change.
        expect(applyButton()).not.toBeDisabled();
        fireEvent.click(applyButton());
        expect((await screen.findAllByText(/Change a destination network/, {}, WAIT)).length).toBeGreaterThan(0);
        await openNetworks();
        expect(screen.getByLabelText('Litecoin')).not.toBeChecked();
        fireEvent.click(screen.getByLabelText('Litecoin'));
        closeNetworks();
        await networksField('Destination networks: Litecoin');
        await waitFor(() => expect(applyButton()).not.toBeDisabled(), WAIT);
    });

    // The boxes emit the networks in the form's own order, so a stored list in
    // another order, or with a repeat, names the same networks and is no change.
    it.each(['LTC,BTC', 'BTC,LTC,BTC'])('treats the untouched form over a stored %s as unchanged', async (bridgeChains) => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains,
        });
        // The field lists the networks in the form's order, whatever the stored order.
        await networksField('Destination networks: Bitcoin, Litecoin');
        // G22: unchanged, Apply stays enabled and a press says what to change.
        expect(applyButton()).not.toBeDisabled();
        fireEvent.click(applyButton());
        expect((await screen.findAllByText(/Change a destination network/, {}, WAIT)).length).toBeGreaterThan(0);
        await openNetworks();
        expect(screen.getByLabelText('Bitcoin')).toBeChecked();
        expect(screen.getByLabelText('Litecoin')).toBeChecked();
        fireEvent.click(screen.getByLabelText('Litecoin'));
        closeNetworks();
        await networksField('Destination networks: Bitcoin');
        await waitFor(() => expect(applyButton()).not.toBeDisabled(), WAIT);
    });

    it('says plainly that closing a network never strands existing holders', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const note = await screen.findByText(/closes the door to NEW transfers/i, {}, WAIT);
        expect(note.textContent).toContain('holders can still bring those');
    });
});

describe('TokenAdminForm bridge settings: policy and freeze refusals', () => {
    it('refuses to open a list-bound token and names the required detach', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, allowList: '1234',
        });
        const msg = await screen.findByText(/bound to an address list/i, {}, WAIT);
        expect(msg.textContent).toContain('would carry none of that policy on the other network');
        expect(msg.textContent).toContain('Detach the policy list first');
        expect(await networksField()).toBeDisabled();
    });

    it('refuses every change once the settings are frozen', async () => {
        mountAdmin({
            chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'BTC', lockBridge: true,
        });
        const msg = await screen.findByText(/frozen for good/i, {}, WAIT);
        expect(msg).toBeInTheDocument();
        expect(await networksField('Destination networks: Bitcoin')).toBeDisabled();
        expect(screen.getByLabelText(/Minimum confirmations/i, { selector: 'input' })).toBeDisabled();
        // And there is no freeze switch to re-apply, nor its warning.
        expect(screen.queryByRole('switch', { name: /Freeze settings permanently/i })).toBeNull();
        expect(document.querySelector('[data-bridge-freeze-warning]')).toBeNull();
    });

    // G120: the warning is a static red note under the field, there before the
    // owner touches the switch, so it is read before freezing, not after.
    it('warns that the freeze is one-way before the switch is touched', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const freeze = await screen.findByRole('switch', { name: 'Freeze settings permanently' }, WAIT);
        expect(freeze).not.toBeChecked();
        const warning = document.querySelector('[data-bridge-freeze-warning]');
        expect(warning).toBeTruthy();
        expect(warning.getAttribute('data-tone')).toBe('danger');
        expect(warning.getAttribute('role')).toBe('note');
        expect(warning.textContent).toContain('Freezing is one-way');
        expect(warning.textContent).toContain('by you or by a future owner');
        fireEvent.click(freeze);
        expect(freeze).toBeChecked();
        expect(document.querySelector('[data-bridge-freeze-warning]')).toBe(warning);
        fireEvent.click(freeze);
        expect(document.querySelector('[data-bridge-freeze-warning]')).toBe(warning);
    });

    // G120: flipping a toggle never shows or hides a notice anywhere on the form.
    const noticeCount = () => document.querySelectorAll('[data-tone]').length;
    async function settledForm() {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        // Token info has loaded once the venue note is up; count after that.
        await screen.findByText(/does not report the token's current bridge setting/i, {}, WAIT);
        return screen.findByRole('switch', { name: 'Freeze settings permanently' }, WAIT);
    }

    it('toggling the freeze switch changes no notice count', async () => {
        const freeze = await settledForm();
        const before = noticeCount();
        expect(before).toBeGreaterThan(0);
        fireEvent.click(freeze);
        expect(noticeCount()).toBe(before);
        fireEvent.click(freeze);
        expect(noticeCount()).toBe(before);
    });

    it('toggling the freeze switch after a failed apply changes no notice count', async () => {
        const freeze = await settledForm();
        fireEvent.click(applyButton());
        expect((await screen.findAllByText(/Change a destination network/, {}, WAIT)).length).toBeGreaterThan(0);
        const before = noticeCount();
        fireEvent.click(freeze);
        expect(noticeCount()).toBe(before);
        expect(screen.getAllByText(/Change a destination network/).length).toBeGreaterThan(0);
        fireEvent.click(freeze);
        expect(noticeCount()).toBe(before);
    });

    it('does not pre-fill, and says so, when the venue reports no bridge field', async () => {
        // An absent field is NOT an opt-out: back-filling unchecked boxes as if
        // it were would let an issuer "confirm" a setting they never made.
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {} });
        const note = await screen.findByText(/does not report the token's current bridge setting/i, {}, WAIT);
        expect(note.textContent).toContain('nothing below is pre-filled');
    });
});

describe('IssueTokenForm: bridge settings stay on their own form', () => {
    it('does not show the bridge explainer or bridge controls', async () => {
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
        await screen.findByLabelText('Ticker', {}, WAIT);
        expect(screen.queryByText(/Bridging is off/i)).toBeNull();
        expect(screen.queryByText(/bound list can never be cleared/i)).toBeNull();
        expect(screen.queryByLabelText(/Bridge/i)).toBeNull();
    });
});

// The refusal leads the page, above the network boxes, the depth field and the
// credentials, so the Review press that raised it moves focus there.
describe('TokenAdminForm bridge settings: a Review refusal takes focus', () => {
    it('focuses the depth refusal raised by the Review press', async () => {
        mountAdmin({ chainId: DOGE, tick: 'FUFU', locks: {}, bridgeChains: 'BTC' });
        const depth = await screen.findByLabelText(/Minimum confirmations/i, { selector: 'input' }, WAIT);
        fireEvent.change(depth, { target: { value: 'six' } });
        await waitFor(() => expect(applyButton()).not.toBeDisabled(), WAIT);
        applyButton().focus();
        fireEvent.click(applyButton());
        // G120 form errors: the refusal is listed in the form error notice and
        // also under its field, so read it from the notice that takes focus.
        const summary = await screen.findByRole('alert', { name: 'Form errors' }, WAIT);
        expect(summary).toHaveTextContent('Minimum confirmations must be a whole number of blocks.');
        await waitFor(() => expect(summary.contains(document.activeElement)).toBe(true), WAIT);
    });
});
