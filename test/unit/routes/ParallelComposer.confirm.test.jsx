// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
afterEach(() => cleanup());

function mount({ walletMode = 'full', messagingOverrides = {}, initialRows, onBack = () => {} } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode })),
        signerReady: vi.fn(async () => ({ ready: true })),
        validateAction: vi.fn(async () => ({ valid: true, errors: [] })),
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
                onBack={onBack}
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
    it.each([
        ['empty required fields', 'AMOUNT is required'],
        ['zero amounts', 'AMOUNT must be greater than zero'],
        ['negative amounts', 'AMOUNT must not be negative'],
        ['excess precision', 'AMOUNT can have at most 8 decimal places'],
        ['malformed addresses', 'DESTINATION must be a valid crypto address'],
        ['malformed ids', 'ASSET_ID must be a numeric id'],
        ['out-of-range numbers', 'BLOCK_INDEX must be between 1 and 1000'],
    ])('validates %s before opening Review and renders plain copy', async (_case, message) => {
        const validateAction = vi.fn(async () => ({
            valid: false,
            errors: [{ code: 'INVALID_FIELD_VALUE', message, detail: { private: true } }],
        }));
        const messaging = mount({ messagingOverrides: { validateAction } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

        expect(await screen.findByText(`Row 1: ${message}`)).toBeTruthy();
        expect(screen.getByRole('form', { name: 'Compose parallel actions' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review parallel actions' })).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('[object Object]');
        expect(validateAction).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            action: 'SEND',
            params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' },
        });
    });

    it('validates every row before Review even when an earlier row is invalid', async () => {
        const validateAction = vi.fn(async ({ params }) => ({
            valid: false,
            errors: [{ message: `${params.MARKER} is invalid` }],
        }));
        mount({
            messagingOverrides: { validateAction },
            initialRows: [
                { chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0', MARKER: 'first' } },
                { chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0', MARKER: 'second' } },
            ],
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Row 1: first is invalid')).toBeTruthy();
        expect(validateAction).toHaveBeenCalledTimes(2);
        expect(validateAction.mock.calls.map(([request]) => request.params.MARKER))
            .toEqual(['first', 'second']);
    });

    it('shows the exact source and params passed to the builder, and header Back keeps the draft', async () => {
        const onBack = vi.fn();
        const messaging = mount({ onBack });
        const params = {
            VERSION: '0',
            TICK: 'TOKEN',
            AMOUNT: '2.50000000',
            DESTINATION: 'bc1qreviewdestination',
            MEMO: 'keep this text',
        };
        const paramsJson = JSON.stringify(params, null, 2);
        const editor = await screen.findByRole('textbox', { name: 'Params (JSON object)' });
        fireEvent.change(editor, { target: { value: paramsJson } });

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByRole('checkbox')).toBeTruthy();
        expect(screen.getByLabelText(FROM.address)).toBeTruthy();
        expect(screen.getByText('Send (SEND)')).toBeTruthy();
        expect(screen.getByText((_text, element) => (
            element?.tagName === 'DD' && element.textContent === paramsJson
        ))).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByRole('form', { name: 'Compose parallel actions' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Params (JSON object)' }).value).toBe(paramsJson);
        expect(onBack).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            from: expect.objectContaining({ address: FROM.address }),
            actionData: { action: 'SEND', params },
        })));
    });

    it('refuses data that becomes invalid after Review and returns to the populated form', async () => {
        const validateAction = vi.fn()
            .mockResolvedValueOnce({ valid: true, errors: [] })
            .mockResolvedValueOnce({
                valid: false,
                errors: [{ message: 'QUOTE_HEIGHT has expired. Refresh it and try again.' }],
            });
        const messaging = mount({ messagingOverrides: { validateAction } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        expect(await screen.findByText(
            'Row 1: QUOTE_HEIGHT has expired. Refresh it and try again.',
        )).toBeTruthy();
        expect(screen.getByRole('form', { name: 'Compose parallel actions' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Params (JSON object)' }).value)
            .toContain('bc1qdestination');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the narrow draft controls contained and identifies each row state', async () => {
        mount();

        const fromPicker = await screen.findByRole('combobox', { name: 'From address' });
        expect(fromPicker.className).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Params (JSON object)' }).className).toBeTruthy();
        expect(screen.getByLabelText('Row 1 status: Pending')).toHaveTextContent('Pending');
    });

    it('states the no-rollback consequence in the required acknowledgement', async () => {
        mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        await screen.findByRole('checkbox');
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

    it('returns from review without submitting the compose form again', async () => {
        mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        expect(screen.getByRole('form', { name: 'Review parallel actions' })).toBeTruthy();

        const clickAllowed = fireEvent.click(screen.getByRole('button', { name: 'Back to composer' }));

        expect(clickAllowed).toBe(false);
        expect(screen.getByRole('form', { name: 'Compose parallel actions' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review parallel actions' })).toBeNull();
    });

    it('dry-runs and confirms each row before signing the composed PSBT', async () => {
        const messaging = mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
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

    it('blocks signing when preflight reports that the row is above balance', async () => {
        const preflight = vi.fn(async () => ({
            verdict: 'fail',
            findings: [{
                code: 'BALANCE_INSUFFICIENT',
                severity: 'error',
                overridable: false,
                message: 'Balance of TOKEN (1) does not cover the send total (2).',
            }],
            unverified: [],
        }));
        const messaging = mount({ messagingOverrides: { preflight } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        expect(await screen.findByText('Balance of TOKEN (1) does not cover the send total (2).'))
            .toBeTruthy();
        expect(screen.getByTestId('confirm-approve')).toBeDisabled();
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });

    it('re-quotes a native fee and refuses stale built bytes before signing', async () => {
        const composeForConfirm = vi.fn(async () => ({
            ...COMPOSED,
            quote: { requiredFeeSats: 2_000_000, feeDestination: 'fee-destination' },
        }));
        const requoteNativeFee = vi.fn(async () => ({
            supported: true,
            valid: true,
            coin: 'BTC',
            feeDestination: 'fee-destination',
            requiredFeeSats: 4_000_000,
            minAcceptable: '0.03800000',
            maxAcceptable: '0.04400000',
        }));
        const messaging = mount({ messagingOverrides: { composeForConfirm, requoteNativeFee } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));

        expect(await screen.findByText(/The protocol fee changed while this was on screen/)).toBeTruthy();
        expect(requoteNativeFee).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            actionString: COMPOSED.actionString,
            source: FROM.address,
        });
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });

    it('announces progress and offers an explicit retry after a row fails', async () => {
        const advancedAction = vi.fn()
            .mockRejectedValueOnce(new Error('Broadcast refused.'))
            .mockResolvedValueOnce({ txid: 'retry-txid' });
        const messaging = mount({ messagingOverrides: { advancedAction } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
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
        fireEvent.click(await screen.findByRole('checkbox'));
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
        fireEvent.click(await screen.findByRole('checkbox'));
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
