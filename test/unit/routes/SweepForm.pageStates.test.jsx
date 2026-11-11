// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the Sweep screen lays out through the FormPage template:
// the address-load error leads the page as FormPage's status, the loading
// line and the broadcast result sit inside the form, and the unsigned and
// queued result screens render inside a FormPage too. None of them draws
// straight into the bare Screen.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';

const confirmResult = { current: null, calls: 0 };

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useConfirmAction: () => ({
            confirm: async () => { confirmResult.calls += 1; return confirmResult.current; },
            approve() {},
            reject() {},
            acknowledge() {},
            phase: 'idle',
            composing: false,
            composed: null,
            report: null,
            error: null,
            acknowledged: new Set(),
            source: null,
            canApprove: false,
        }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';
import { clearMigrationSweeps } from '../../../packages/core/src/flows/migrationSweeps.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const EMPTY_PREVIEW = Object.freeze({
    balances: { rows: [], error: null },
    ownerships: { rows: [], error: null },
    orders: { rows: [], error: null },
    swaps: { rows: [], error: null },
    dispensers: { rows: [], error: null },
    gatedTicks: { rows: [], error: null, partial: false },
});

function mountSweep({ getAddressesByChain, migrate = false, walletMode = 'full' } = {}) {
    const target = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode }),
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
    const props = migrate
        ? {
            initialChainId: CHAIN,
            initialFromAddress: SOURCE.address,
            initialDestination: DESTINATION,
            migrateTo: { walletId: 'wallet-new', name: 'New wallet', address: DESTINATION },
        }
        : {};
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SweepForm walletId="wallet-old" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return container;
}

async function submit(container) {
    await waitFor(() => {
        const button = container.querySelector('button[type="submit"]');
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(false);
    });
    fireEvent.click(container.querySelector('button[type="submit"]'));
}

/** The element whose text matches, searched among the given tags. */
function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

afterEach(() => {
    cleanup();
    clearMigrationSweeps();
    localStorage.clear();
    confirmResult.current = null;
    confirmResult.calls = 0;
});

describe('SweepForm lays out every page state through FormPage', () => {
    it('names the watcher action and explains the offline signing handoff', async () => {
        const container = mountSweep({ migrate: true, walletMode: 'watcher' });
        const sweep = await within(container).findByRole('button', { name: 'Sweep' });

        fireEvent.click(sweep);

        await waitFor(() => expect(container).toHaveTextContent(
            'Watcher mode: this prepares the transaction for your offline signer. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
        ));
    });

    it('shows the address-load error as the FormPage status', async () => {
        const container = mountSweep({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        await waitFor(() => expect(container.querySelector('[data-form-status]')).not.toBeNull());
        expect(container.querySelector('[data-form-status]').textContent).toContain('Address store unavailable');
        expect(container.querySelector('form')).not.toBeNull();
    });

    it('puts the loading line inside the FormPage form', () => {
        const container = mountSweep({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading');
        expect(loading).not.toBeNull();
        expect(loading.closest('form')).not.toBeNull();
    });

    it('puts the broadcast result and its Done action inside the FormPage form', async () => {
        confirmResult.current = { txid: 'sweep-txid' };
        const container = mountSweep({ migrate: true });
        await submit(container);
        await waitFor(() => expect(container.textContent).toContain('Sweep broadcast'));
        const title = byText(container, 'h2', 'Sweep broadcast');
        const form = title.closest('form');
        expect(form).not.toBeNull();
        expect(form.textContent).toContain('sweep-txid');
        expect(byText(form, 'button', 'Done')).not.toBeNull();
        expect(container.querySelectorAll('h2')).toHaveLength(1);
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
    ])('renders the result screen for %s inside a FormPage form', async (_label, result) => {
        confirmResult.current = result;
        const container = mountSweep({ migrate: true });
        await submit(container);
        await waitFor(() => expect(container.querySelector('[data-testid="result-screen-notice"]')).not.toBeNull());
        expect(container.querySelector('[data-testid="result-screen-notice"]').closest('form')).not.toBeNull();
    });
});
