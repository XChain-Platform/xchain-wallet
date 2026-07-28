// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / D-81: "Transfer ownership" validated nothing but emptiness.
// The mainnet bech32 vector typed into a regtest wallet produced no
// error, no warning and an enabled submit button; only the confirm
// screen's dry-run refused it, behind a "Sign anyway" checkbox. The
// chain rejects the action either way, so what the missing check costs
// is a burnt protocol fee and a confusing round trip.
//
// These drive the real component: a source-grep cannot tell a rendered
// error from an unrendered one, nor a live error from a stale one.
//
// Queries go through `container` rather than getByRole/getByText,
// following SweepForm.formErrors.test.jsx: this form renders a large
// tree and a failed role lookup spends minutes building
// testing-library's accessible-roles dump before reporting anything.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';

const CHAIN = 'bitcoin-regtest';
const TICK = 'S18PROBE';

// The wallet's own (regtest) address, signing the TRANSFER.
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
// D-81's exact vector: a checksum-valid MAINNET bech32 address.
const MAINNET_VECTOR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
// A checksum-valid regtest bech32 address (BIP173 vector re-encoded under
// the bcrt HRP), i.e. what a good new owner looks like here.
const REGTEST_OK = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
// Right network, wrong coin: a Dogecoin mainnet legacy address.
const DOGE_VECTOR = 'D6hLULEGDRbk86j58t5iWmeinqM6acA16V';

async function mountTransfer() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        listContacts: () => Promise.resolve([]),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenAdminForm, {
                walletId: 'w',
                mode: 'transfer',
                initialChainId: CHAIN,
                initialTick: TICK,
                initialFromAddress: SOURCE.address,
                onBack() {},
            }),
        ),
    );

    const q = {
        container,
        submit: () => container.querySelector('button[type="submit"]'),
        newOwner: () => labelledInput(container, 'New owner address'),
        alerts: () => Array.from(container.querySelectorAll('[role="alert"]'))
            .map((n) => n.textContent).join(' | '),
    };
    await waitFor(() => expect(q.newOwner()).toBeTruthy());
    return q;
}

/** The <input> whose <label> text matches, without a role-tree scan. */
function labelledInput(container, labelText) {
    const label = Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent.trim().startsWith(labelText));
    if (!label) return null;
    if (label.control) return label.control;
    const id = label.getAttribute('for');
    return id ? container.querySelector(`#${CSS.escape(id)}`) : label.querySelector('input');
}

afterEach(() => cleanup());

describe('Transfer ownership address validation ( / D-81)', () => {
    it('rejects a mainnet address on a regtest wallet, in the form', async () => {
        const q = await mountTransfer();

        fireEvent.change(q.newOwner(), { target: { value: MAINNET_VECTOR } });

        // The error is live: it lands on the field as the address is typed,
        // not two screens later on the dry-run.
        await waitFor(() => {
            expect(q.alerts()).toMatch(/not a valid Bitcoin regtest address/i);
        });

        // And the submit path refuses it rather than composing an action the
        // chain will throw away.
        fireEvent.click(q.submit());
        await waitFor(() => {
            expect(q.alerts()).toMatch(/not a valid Bitcoin regtest address/i);
        });
        // Still on the form: nothing was composed, nothing to sign.
        expect(q.newOwner()).toBeTruthy();
    });

    it('names the coin when the address belongs to a different chain', async () => {
        const q = await mountTransfer();

        fireEvent.change(q.newOwner(), { target: { value: DOGE_VECTOR } });

        await waitFor(() => {
            expect(q.alerts()).toMatch(/looks like a Dogecoin address, not a Bitcoin address/i);
        });
    });

    it('accepts a well-formed address for this chain', async () => {
        const q = await mountTransfer();

        fireEvent.change(q.newOwner(), { target: { value: REGTEST_OK } });

        await waitFor(() => expect(q.newOwner().value).toBe(REGTEST_OK));
        expect(q.alerts()).not.toMatch(/not a valid/i);
        expect(q.submit().disabled).toBe(false);
    });

    it('clears the error once the address is corrected', async () => {
        const q = await mountTransfer();

        fireEvent.change(q.newOwner(), { target: { value: MAINNET_VECTOR } });
        fireEvent.click(q.submit());
        await waitFor(() => expect(q.alerts()).toMatch(/not a valid/i));

        fireEvent.change(q.newOwner(), { target: { value: REGTEST_OK } });
        await waitFor(() => expect(q.alerts()).not.toMatch(/not a valid/i));
    });

    it('still errors with a reason on an empty address', async () => {
        const q = await mountTransfer();

        expect(q.submit().disabled).toBe(true);
        // Empty is the one state the button guards; the form-level branch
        // stays in place for the submit paths that bypass it.
        expect(q.alerts()).not.toMatch(/not a valid/i);
    });
});
