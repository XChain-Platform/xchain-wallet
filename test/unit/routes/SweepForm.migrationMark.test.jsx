// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A migration sweep marks its legacy address on the kept Migrate-to-BIP39
// list once it broadcasts, so the list the user returns to shows which
// addresses are done. A queued, unsigned or interrupted result moves nothing
// and leaves the row offered.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

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
import {
    clearMigrationSweeps,
    readMigrationSweeps,
    recordMigration,
    setMigrationRows,
} from '../../../packages/core/src/flows/migrationSweeps.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/0'/0/0",
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

function mountMigrationSweep(migrateTo = { walletId: 'wallet-new', name: 'New wallet', address: DESTINATION }) {
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
        <MessagingProvider shell="web" messaging={messaging}>
            <SweepForm
                walletId="wallet-old"
                onBack={() => {}}
                initialChainId={CHAIN}
                initialFromAddress={SOURCE.address}
                initialDestination={DESTINATION}
                migrateTo={migrateTo}
            />
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

function sourceRow() {
    return readMigrationSweeps('wallet-old').rows.find((row) => row.fromAddress === SOURCE.address);
}

beforeEach(() => {
    recordMigration('wallet-old', 'wallet-new');
    setMigrationRows('wallet-old', 'wallet-new', [
        { chainId: CHAIN, fromAddress: SOURCE.address, toAddress: DESTINATION },
        { chainId: CHAIN, fromAddress: 'legacy-second', toAddress: DESTINATION },
    ]);
});

afterEach(() => {
    cleanup();
    clearMigrationSweeps();
    localStorage.clear();
    confirmResult.current = null;
    confirmResult.calls = 0;
});

describe('SweepForm marks its row on the kept migration list', () => {
    it('marks the swept legacy address with its txid once the sweep broadcasts', async () => {
        confirmResult.current = { txid: 'sweep-txid' };
        const container = mountMigrationSweep();
        await submit(container);
        await waitFor(() => expect(container.textContent).toContain('Sweep broadcast'));
        expect(sourceRow()).toMatchObject({ swept: true, txid: 'sweep-txid' });
        expect(readMigrationSweeps('wallet-old').rows[1].swept).toBe(false);
    });

    it.each([
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
        ['interrupted at approve', { interrupted: true, reason: 'fee-changed' }],
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
    ])('leaves the row offered when the sweep is %s', async (_label, result) => {
        confirmResult.current = result;
        const container = mountMigrationSweep();
        await submit(container);
        await waitFor(() => expect(confirmResult.calls).toBe(1));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sourceRow().swept).toBe(false);
    });
});
