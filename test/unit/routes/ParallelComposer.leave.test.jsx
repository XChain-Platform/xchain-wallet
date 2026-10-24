// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Leaving the parallel composer after some rows were broadcast asks first, and
// keeps the rows that were not sent as a draft that resumes without ever
// offering a broadcast row again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN_ID = 'bitcoin-regtest';
const FROM = {
    id: 'address-1',
    address: 'bc1qparallelfromaddress000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const COMPOSED = {
    actionString: 'SEND|0|TOKEN|1|bc1qdestination',
    action: 'SEND',
    version: 0,
    psbt: 'parallel-psbt',
    encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};
const DRAFT_KEY = 'xc:formdraft:parallel-composer:wallet-1';
const THREE_ROWS = ['one', 'two', 'three'].map((MARKER) => ({
    chainId: CHAIN_ID,
    action: 'SEND',
    params: { VERSION: '0', MARKER },
}));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

function mount({ initialRows, onBack = () => {}, messagingOverrides = {} } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        validateAction: vi.fn(async () => ({ valid: true, errors: [] })),
        composeForConfirm: vi.fn(async () => COMPOSED),
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        requoteNativeFee: vi.fn(async () => null),
        reserve: vi.fn(async () => {}),
        releaseReservation: vi.fn(async () => {}),
        advancedAction: vi.fn(async () => ({ txid: 'parallel-txid' })),
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer walletId="wallet-1" onBack={onBack} initialRows={initialRows} />
        </MessagingProvider>,
    );
    return messaging;
}

async function broadcastFirstRow() {
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    fireEvent.click(await screen.findByTestId('confirm-approve'));
    await screen.findByText(/^Action 2 of 3\./);
}

const storedDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY));

describe('ParallelComposer leave guard', () => {
    it('leaves at once while nothing was broadcast', async () => {
        const onBack = vi.fn();
        mount({ initialRows: THREE_ROWS, onBack });
        await screen.findByRole('button', { name: 'Review' });

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onBack).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('asks before leaving part-way and stays when the user cancels', async () => {
        const onBack = vi.fn();
        mount({ initialRows: THREE_ROWS, onBack });
        await broadcastFirstRow();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByText('2 rows have not been sent. Leave anyway?')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText('2 rows have not been sent. Leave anyway?')).toBeNull());
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByText(/^Action 2 of 3\./)).toBeTruthy();
    });

    it('keeps the unsent rows as a draft and resumes them once, never offering the broadcast row', async () => {
        const onBack = vi.fn();
        mount({ initialRows: THREE_ROWS, onBack });
        await broadcastFirstRow();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Leave anyway' }));
        await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));

        const saved = storedDraft().values;
        expect(saved.sentCount).toBe(1);
        expect(saved.rows.map((r) => JSON.parse(r.paramsJson).MARKER)).toEqual(['two', 'three']);

        cleanup();
        const messaging = mount();

        expect(await screen.findByText(
            'Your earlier run stopped part-way. 1 row was already broadcast and will not be sent again. 2 rows have not been sent yet.',
        )).toBeTruthy();
        expect(screen.getAllByText(/^Row \d$/)).toHaveLength(2);
        const markers = screen.getAllByRole('textbox', { name: 'Params (JSON object)' })
            .map((box) => JSON.parse(box.value).MARKER);
        expect(markers).toEqual(['two', 'three']);
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });

    it('clears the draft once the resumed rows are all sent', async () => {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            savedAt: Date.now(),
            values: {
                sentCount: 1,
                rows: [{ chainId: CHAIN_ID, fromAddressId: FROM.id, action: 'SEND', paramsJson: '{"VERSION":"0"}' }],
            },
        }));
        const messaging = mount();
        await screen.findByText(/stopped part-way/);

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));

        expect(await screen.findByText('Parallel run complete')).toBeTruthy();
        expect(messaging.advancedAction).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull());
    });
});
