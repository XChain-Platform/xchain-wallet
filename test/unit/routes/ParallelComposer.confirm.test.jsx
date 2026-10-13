// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
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
const FORM_STYLES = readFileSync(
    'packages/core/src/shared/routes/ParallelComposer.module.css',
    'utf8',
);

afterEach(() => cleanup());

function mount({ walletMode = 'full', messagingOverrides = {}, initialRows } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode })),
        signerReady: vi.fn(async () => ({ ready: true })),
        composeForConfirm: vi.fn(async () => COMPOSED),
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        requoteNativeFee: vi.fn(async () => null),
        reserve: vi.fn(async () => {}),
        releaseReservation: vi.fn(async () => {}),
        advancedAction: vi.fn(async () => ({ txid: 'parallel-txid' })),
        buildActionPsbtRequest: vi.fn(async () => ({ psbtHex: 'aa00', encoding: 'psbt' })),
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={initialRows || [{
                    chainId: CHAIN_ID,
                    action: 'SEND',
                    params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' },
                }]}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('ParallelComposer confirmation', () => {
    it('keeps the narrow draft controls contained and identifies each row state', async () => {
        mount();

        const fromPicker = await screen.findByRole('combobox', { name: 'From address' });
        expect(fromPicker.className).toBeTruthy();
        expect(FORM_STYLES).toMatch(/\.rowEditor select,[^{]*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%/s);
        expect(screen.getByLabelText('Row 1 status: Pending')).toHaveTextContent('Pending');
    });

    it('states the no-rollback consequence in the required acknowledgement', async () => {
        mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        expect(screen.getByText('No rollback:')).toBeTruthy();
        const acknowledgement = screen.getByRole('checkbox', {
            name: 'I understand successful actions cannot be rolled back if a later action fails.',
        });
        expect(acknowledgement).toHaveAttribute('aria-describedby', 'parallel-no-rollback-warning');
        const signAll = screen.getByRole('button', { name: 'Sign all' });
        expect(signAll.disabled).toBe(true);
        fireEvent.click(acknowledgement);
        expect(signAll.disabled).toBe(false);
    });

    it('dry-runs and confirms each row before signing the composed PSBT', async () => {
        const messaging = mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith(expect.objectContaining({
            actionString: COMPOSED.actionString,
            source: FROM.address,
        })));
        expect(messaging.advancedAction).not.toHaveBeenCalled();
        expect(screen.getByLabelText(FROM.address)).toBeTruthy();

        fireEvent.click(screen.getByTestId('confirm-approve'));

        await waitFor(() => expect(messaging.advancedAction).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: CHAIN_ID,
            from: expect.objectContaining({ address: FROM.address }),
            action: 'SEND',
            params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' },
            prebuiltPsbt: expect.objectContaining({ psbtHex: COMPOSED.psbt }),
        })));
        expect(await screen.findByText('Parallel run complete')).toBeTruthy();
    });

    it('announces progress and offers an explicit retry after a row fails', async () => {
        const advancedAction = vi.fn()
            .mockRejectedValueOnce(new Error('Broadcast refused.'))
            .mockResolvedValueOnce({ txid: 'retry-txid' });
        const messaging = mount({ messagingOverrides: { advancedAction } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));

        const progress = screen.getByText(
            'Action 1 of 1. 0 broadcast, 0 skipped, 1 remaining. Current row: Pending.',
        );
        expect(progress.getAttribute('role')).toBe('status');
        expect(progress).toHaveAttribute('aria-live', 'polite');
        expect(progress).toHaveAttribute('aria-atomic', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));

        const retry = await screen.findByRole('button', { name: 'Retry row' });
        expect(screen.getByText(/Current row: Failed\./)).toHaveAttribute('role', 'status');
        expect(screen.getByLabelText('Status: Failed')).toHaveTextContent('Failed');

        fireEvent.click(retry);
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        expect(await screen.findByText('Parallel run complete')).toBeTruthy();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(2);
        expect(advancedAction).toHaveBeenCalledTimes(2);
    });

    it('announces skipped rows accurately and does not call them broadcast', async () => {
        mount({
            initialRows: [
                { chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0' } },
                { chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0' } },
            ],
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

        expect(screen.getByText(
            'Action 2 of 2. 0 broadcast, 1 skipped, 1 remaining. Current row: Pending.',
        )).toHaveAttribute('role', 'status');

        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(await screen.findByText('Run finished. Skipped rows were not signed or broadcast.')).toBeTruthy();
        expect(screen.queryByText(/^All rows broadcast/)).toBeNull();
    });

    it('names an action refused on the row\'s chain by its display label, not its wire code', async () => {
        const ltcFrom = { ...FROM, id: 'address-ltc', address: 'ltc1qparallelfromaddress00000000000000000000' };
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ 'litecoin-mainnet': [ltcFrom] })),
            getActiveAddresses: vi.fn(async () => ({ 'litecoin-mainnet': ltcFrom })),
            listActions: vi.fn(async () => ['SEND', 'COLLECT']),
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            signerReady: vi.fn(async () => ({ ready: true })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ParallelComposer
                    walletId="wallet-1"
                    onBack={() => {}}
                    initialRows={[{ chainId: 'litecoin-mainnet', action: 'COLLECT', params: {} }]}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Row 1: Collect rewards is not available on Litecoin.')).toBeTruthy();
        expect(screen.queryByText(/COLLECT is not available/)).toBeNull();
    });

    it('shows an unsigned transaction without completing the row in watcher mode', async () => {
        const messaging = mount({ walletMode: 'watcher' });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        expect(await screen.findByRole('heading', {
            name: 'Unsigned transaction, ready for signing',
        })).toBeTruthy();
        expect(screen.getByLabelText('Unsigned transaction hex').value).toBe('aa00');
        expect(screen.queryByText('Parallel run complete')).toBeNull();
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });
});
