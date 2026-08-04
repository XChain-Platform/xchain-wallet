// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / D-58: SweepForm's form-level error survived the edit that
// answered it. Submit a bad destination, correct it (or empty the
// field), and the stale red line stayed up until the next submit - so
// an EMPTY destination sat under "This is not a valid Bitcoin regtest
// address", which is not what was wrong with it.
//
// The same finding exposed two `handleReview` branches that could never
// fire: "Destination address is required." and "Select at least one
// category to sweep." were both guarded by a submit button disabled in
// exactly those two states, so the user got a dead button and no
// reason. Send errors on an empty destination rather than disabling;
// SWEEP now agrees, which makes both branches reachable.
//
// These drive the real component. A source-grep smoke cannot tell a
// cleared error from an uncleared one.
//
// Queries go through `container` rather than getByRole/getByText: this
// form renders a large tree, and a failed role lookup spends minutes
// building testing-library's "here are the accessible roles" dump
// before it reports anything.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';

const CHAIN = 'bitcoin-mainnet';
// Both addresses are checksum-valid mainnet bech32 (the BIP173 vectors),
// because the destination battery runs a real checksum check: a made-up
// address short-circuits at the format branch and never reaches the
// same-as-source or category branches this file is about.
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
// A valid address the wallet does not own, so validation passes the
// format gate and reaches the later branches.
const OTHER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

async function mountSweep() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        sweepPreview: () => Promise.resolve({ rows: [], gatedTicks: { rows: [] } }),
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
            React.createElement(SweepForm, { walletId: 'w', onBack() {} }),
        ),
    );

    const q = {
        container,
        submit: () => container.querySelector('button[type="submit"]'),
        destination: () => labelledInput(container, 'Destination address'),
        memo: () => labelledInput(container, 'Memo (optional)'),
        category: (text) => Array.from(container.querySelectorAll('label'))
            .find((l) => l.textContent.includes(text))
            ?.querySelector('input[type="checkbox"]'),
        /** Text of every rendered alert, joined. Cheap and dump-free. */
        alerts: () => Array.from(container.querySelectorAll('[role="alert"]'))
            .map((n) => n.textContent).join(' | '),
    };
    // Wait for the loaded form: the source resolves and the destination
    // field exists (before that the route renders "Loading…").
    //
    // AND for the submit button to be live, which is a SEPARATE condition and
    // is the one every test below actually depends on. The button is disabled
    // by `!fromAddress || confirmAction.composing`, and the destination field
    // does NOT imply a resolved `fromAddress`: the form renders the whole
    // body either way, putting a "No address on this chain" alert where the
    // From field goes. So a gate that waits only for the field could return
    // before a source existed, and the next line -
    // `expect(q.submit().disabled).toBe(false)` - was a race against a render
    // rather than an assertion about behaviour. It won that race on every dev
    // box and lost it on the `coverage` job and on the devhost CI venue,
    // where it read as the  fix having regressed .
    //
    // The window itself is gone: useActionForm now derives the default source
    // in the same render that receives the addresses, so there is no longer a
    // render with the addresses loaded and no source (driven in
    // actionFormSourceSelection.test.jsx). This gate stays anyway, because
    // what these cases need is a submittable form, and saying so is cheap.
    //
    // Nothing in this file wants a disabled button: both cases assert `false`,
    // because the whole point of  / D-58 is that an empty destination
    // errors with a reason instead of presenting a dead control. So "loaded"
    // for this file means the form is ready to be submitted.
    await waitFor(() => {
        expect(q.destination()).toBeTruthy();
        expect(q.submit()).toBeTruthy();
        expect(q.submit().disabled).toBe(false);
    });
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

describe('SweepForm form-level errors ( / D-58)', () => {
    it('an empty destination errors with the reason instead of a dead button', async () => {
        const q = await mountSweep();

        expect(q.submit().disabled).toBe(false);
        fireEvent.click(q.submit());

        await waitFor(() => {
            expect(q.alerts()).toContain('Destination address is required.');
        });
    });

    it('zero selected categories errors with the reason instead of a dead button', async () => {
        const q = await mountSweep();
        // A valid third-party destination so validation reaches the
        // category check; then untick the two default-ON categories.
        fireEvent.change(q.destination(), { target: { value: OTHER } });
        fireEvent.click(q.category('Token balances'));
        fireEvent.click(q.category('Token ownerships'));

        expect(q.submit().disabled).toBe(false);
        fireEvent.click(q.submit());

        await waitFor(() => {
            expect(q.alerts()).toContain('Select at least one category to sweep.');
        });
    });

    it('editing the destination clears a stale destination error', async () => {
        const q = await mountSweep();

        fireEvent.change(q.destination(), { target: { value: 'not-an-address' } });
        fireEvent.click(q.submit());
        await waitFor(() => expect(q.alerts()).toMatch(/not a valid/i));

        // Emptying the field is the case that read worst: the old code
        // left "this is not a valid address" under a field holding
        // nothing at all.
        fireEvent.change(q.destination(), { target: { value: '' } });
        await waitFor(() => expect(q.alerts()).not.toMatch(/not a valid/i));
    });

    it('re-selecting a category clears the stale "select at least one" error', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: OTHER } });
        fireEvent.click(q.category('Token balances'));
        fireEvent.click(q.category('Token ownerships'));
        fireEvent.click(q.submit());
        await waitFor(() => {
            expect(q.alerts()).toContain('Select at least one category to sweep.');
        });

        fireEvent.click(q.category('Token balances'));
        await waitFor(() => {
            expect(q.alerts()).not.toContain('Select at least one category to sweep.');
        });
    });

    it('editing the memo clears a stale memo error', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: OTHER } });
        fireEvent.change(q.memo(), { target: { value: 'a|b' } });
        fireEvent.click(q.submit());
        await waitFor(() => expect(q.alerts()).toMatch(/Memo cannot contain/));

        fireEvent.change(q.memo(), { target: { value: 'ab' } });
        await waitFor(() => expect(q.alerts()).not.toMatch(/Memo cannot contain/));
    });

    it('the same-as-source error clears once the destination is changed', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: SOURCE.address } });
        fireEvent.click(q.submit());
        await waitFor(() => expect(q.alerts()).toMatch(/would move nothing anywhere/));

        fireEvent.change(q.destination(), { target: { value: OTHER } });
        await waitFor(() => expect(q.alerts()).not.toMatch(/would move nothing anywhere/));
    });
});
