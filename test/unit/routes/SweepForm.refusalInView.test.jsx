// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Sweep button sits below every section of the form. In a 400x600 or
// 360x600 extension popup a refusal written to the form status at the top,
// or to the destination field mid-form, is out of view when the button is
// pressed, so the press reads as a dead button. A refused Sweep moves focus
// to the refusal and scrolls it into view.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
// A checksum-valid Litecoin address: the wrong chain for a Bitcoin sweep.
// A valid third-party Bitcoin address, so validation reaches the later checks.
const OTHER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LITECOIN = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';

const EMPTY_PREVIEW = Object.freeze({
    balances: { rows: [], error: null },
    ownerships: { rows: [], error: null },
    orders: { rows: [], error: null },
    swaps: { rows: [], error: null },
    dispensers: { rows: [], error: null },
    gatedTicks: { rows: [], error: null, partial: false },
});

function labelledInput(container, label) {
    const labelEl = Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent.trim().startsWith(label));
    if (!labelEl) return null;
    const id = labelEl.getAttribute('for');
    return id ? container.querySelector(`[id="${id}"]`) : labelEl.querySelector('input');
}

async function mountSweep() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        sweepPreview: () => Promise.resolve(EMPTY_PREVIEW),
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
            { shell: 'extension', messaging },
            React.createElement(SweepForm, { walletId: 'w', onBack: vi.fn() }),
        ),
    );
    const q = {
        container,
        submit: () => container.querySelector('button[type="submit"]'),
        destination: () => labelledInput(container, 'Destination address'),
        memo: () => labelledInput(container, 'Memo (optional)'),
        category: (text) => within(container).getByRole('checkbox', { name: new RegExp(text) }),
    };
    await waitFor(() => {
        expect(q.destination()).toBeTruthy();
        expect(q.submit()).toBeTruthy();
        expect(q.submit().disabled).toBe(false);
    });
    return q;
}

describe('SweepForm brings a refusal into view', () => {
    let scrolled;

    beforeEach(() => {
        scrolled = [];
        Element.prototype.scrollIntoView = vi.fn(function scrollIntoView() { scrolled.push(this); });
    });

    afterEach(() => {
        cleanup();
        delete Element.prototype.scrollIntoView;
    });

    async function expectStatusInView(q, pattern) {
        await waitFor(() => {
            const status = q.container.querySelector('[data-form-status]');
            expect(status?.textContent).toMatch(pattern);
            expect(document.activeElement).toBe(status);
            expect(scrolled).toContain(status);
        });
    }

    it('focuses and scrolls to the form status when the destination is empty', async () => {
        const q = await mountSweep();
        fireEvent.click(q.submit());
        await expectStatusInView(q, /Destination address is required/);
    });

    it('focuses and scrolls to the form status when no category is selected', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: OTHER } });
        fireEvent.click(q.category('Token balances'));
        fireEvent.click(q.category('Token ownerships'));
        fireEvent.click(q.submit());
        await expectStatusInView(q, /Select at least one category to sweep/);
    });

    it('focuses and scrolls to the form status when the memo holds a separator', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: OTHER } });
        fireEvent.change(q.memo(), { target: { value: 'a|b' } });
        fireEvent.click(q.submit());
        await expectStatusInView(q, /Memo cannot contain/);
    });

    it('moves focus again on a repeated refusal of the same kind', async () => {
        const q = await mountSweep();
        fireEvent.click(q.submit());
        await expectStatusInView(q, /Destination address is required/);
        q.submit().focus();
        scrolled.length = 0;
        fireEvent.click(q.submit());
        await expectStatusInView(q, /Destination address is required/);
    });

    it('focuses and scrolls to the form status when a self-sweep is refused', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: SOURCE.address } });
        fireEvent.click(q.submit());

        await waitFor(() => {
            const status = q.container.querySelector('[data-form-status]');
            expect(status?.textContent).toMatch(/Destination is the source address itself/);
            expect(document.activeElement).toBe(status);
            expect(scrolled).toContain(status);
        });
    });

    it('focuses and scrolls to the destination field when a cross-chain address is refused', async () => {
        const q = await mountSweep();
        fireEvent.change(q.destination(), { target: { value: LITECOIN } });
        await waitFor(() => expect(q.destination().getAttribute('aria-invalid')).toBe('true'));
        fireEvent.click(q.submit());

        await waitFor(() => {
            expect(document.activeElement).toBe(q.destination());
            expect(scrolled).toContain(q.destination());
        });
    });
});
