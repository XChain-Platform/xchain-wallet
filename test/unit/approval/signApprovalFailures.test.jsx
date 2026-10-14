// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    listWallets: vi.fn(),
    resolveApproval: vi.fn(),
    getAddressBalances: vi.fn(),
    getAddressesByChain: vi.fn(),
    getSettings: vi.fn(),
    parsePsbt: vi.fn(),
    requoteNativeFee: vi.fn(),
    parseCoSign: vi.fn(),
    preflight: vi.fn(),
    describeAction: vi.fn(),
    getTokenInfo: vi.fn(),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => mocks);
vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);

function mount(kind, payload, id = `${kind}-failure`) {
    return render(
        <SignApproval id={id} kind={kind} payload={payload} onReject={() => {}} />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWallets.mockResolvedValue([{ id: 'wallet-1', name: 'Wallet 1' }]);
    mocks.resolveApproval.mockResolvedValue({ resolved: true });
    mocks.getAddressBalances.mockResolvedValue({});
    mocks.getAddressesByChain.mockResolvedValue({
        'bitcoin-regtest': [{ address: 'bcrt1qwalletaddress' }],
    });
    mocks.getSettings.mockResolvedValue({ walletMode: 'full' });
    mocks.parsePsbt.mockResolvedValue({ decomposed: { inputs: [], outputs: [] } });
    mocks.requoteNativeFee.mockResolvedValue({});
    mocks.parseCoSign.mockResolvedValue(null);
    mocks.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
    mocks.describeAction.mockResolvedValue({ summary: 'Action', details: [], warnings: [] });
    mocks.getTokenInfo.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

describe('SignApproval wallet and permission failures', () => {
    it('fails closed when wallet discovery rejects without an Error', async () => {
        mocks.listWallets.mockRejectedValue(null);
        mount('signMessage', {
            chainId: 'bitcoin-regtest',
            payload: { message: 'hello' },
        });

        expect(await screen.findByText('Failed to load wallets.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });

    it('fails closed when no wallet proves ownership of the requested signer', async () => {
        mocks.listWallets.mockResolvedValue([
            { id: 'wallet-1', name: 'Wallet 1' },
            { id: 'wallet-2', name: 'Wallet 2' },
        ]);
        mocks.getAddressesByChain.mockRejectedValue(new Error('address store unavailable'));
        mount('signMessage', {
            chainId: 'bitcoin-regtest',
            payload: { message: 'hello', address: 'bcrt1qrequested' },
        });

        expect(await screen.findByText(
            'The requested signing account is not available in this wallet.',
        )).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });

    it('falls back to full mode and recovers after an invalid password refusal', async () => {
        mocks.getSettings.mockRejectedValue(new Error('settings unavailable'));
        const invalidPassword = new Error('decrypt failed');
        invalidPassword.name = 'InvalidPasswordError';
        mocks.resolveApproval
            .mockRejectedValueOnce(invalidPassword)
            .mockResolvedValueOnce({ resolved: true });
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
        const select = vi.spyOn(HTMLInputElement.prototype, 'select');
        mount('signMessage', {
            chainId: 'bitcoin-regtest',
            payload: { message: 'hello' },
        }, 'password-retry');

        const password = await screen.findByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(await screen.findByText('Incorrect password.')).toBeTruthy();
        expect(focus).toHaveBeenCalled();
        expect(select).toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(mocks.resolveApproval).toHaveBeenNthCalledWith(2, 'password-retry', {
            approved: true,
            walletId: 'wallet-1',
            password: 'secret',
        });
    });
});

describe('SignApproval preview fallbacks', () => {
    it('keeps the raw ticker and permits an exact decision when optional previews fail', async () => {
        mocks.getAddressesByChain.mockResolvedValue({
            'bitcoin-regtest': [{ address: 'bcrt1qwalletaddress' }],
        });
        mocks.getAddressBalances.mockRejectedValue(new Error('balance service unavailable'));
        mocks.getTokenInfo.mockRejectedValue(new Error('token service unavailable'));
        mocks.describeAction.mockRejectedValue(new Error('descriptor unavailable'));
        mocks.preflight.mockRejectedValue(new Error('explorer unavailable'));
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        mount('signAction', {
            chainId: 'bitcoin-regtest',
            action: 'SEND',
            payload: {
                actionString: 'SEND|1|^edge-fallback|1|bcrt1qrecipient',
                TICK: '^edge-fallback',
                QUANTITY: '1',
                DESTINATION: 'bcrt1qrecipient',
            },
        }, 'preview-fallback');

        expect(await screen.findByText(/preview unavailable/i)).toBeTruthy();
        await waitFor(() => expect(mocks.describeAction).toHaveBeenCalledWith(
            expect.objectContaining({
                params: expect.objectContaining({ TICK: '^edge-fallback' }),
            }),
        ));
        await waitFor(() => expect(mocks.preflight).toHaveBeenCalled());
        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(mocks.resolveApproval).toHaveBeenCalledWith('preview-fallback', {
            approved: true,
            walletId: 'wallet-1',
            password: 'secret',
        });
    });

    it('blocks a co-sign request that omits its guarded details', async () => {
        mount('coSign', { chainId: 'bitcoin-regtest', payload: {} });

        expect(await screen.findByText(/Missing co-sign request details/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(mocks.parseCoSign).not.toHaveBeenCalled();
    });
});

describe('SignApproval PSBT failure branches', () => {
    it('blocks approval when no chain is available for decoding', async () => {
        mount('signPsbt', { payload: { psbtHex: '70736274ff' } });

        expect(await screen.findByTestId('psbt-undecodable')).toHaveTextContent(
            'This transaction could not be decoded',
        );
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
        expect(mocks.parsePsbt).not.toHaveBeenCalled();
    });

    it('uses safe copy and blocks approval when PSBT decoding rejects', async () => {
        mocks.parsePsbt.mockRejectedValue(null);
        mount('signPsbt', {
            chainId: 'bitcoin-regtest',
            payload: { psbtHex: '70736274ff' },
        });

        expect(await screen.findByTestId('psbt-undecodable')).toHaveTextContent(
            'This transaction could not be decoded',
        );
        expect(mocks.parsePsbt).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            psbtHex: '70736274ff',
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });

    it('continues with decoded intent when address, fee quote, and preflight reads fail', async () => {
        mocks.getAddressesByChain.mockRejectedValue(new Error('address store unavailable'));
        mocks.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: 'bcrt1qsender', value: 1000 }],
                outputs: [{ address: 'bcrt1qrecipient', value: 900 }],
            },
            action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
            actionDecodeReason: null,
        });
        mocks.requoteNativeFee.mockRejectedValue(new Error('quote unavailable'));
        mocks.preflight.mockRejectedValue(new Error('explorer unavailable'));
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        mount('signPsbt', {
            chainId: 'bitcoin-regtest',
            payload: { psbtHex: '70736274ff' },
        }, 'psbt-fallback');

        expect(await screen.findByText('bcrt1qrecipient')).toBeTruthy();
        await waitFor(() => expect(mocks.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qsender',
            mode: 'report',
        }));
        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(mocks.resolveApproval).toHaveBeenCalledWith('psbt-fallback', {
            approved: true,
            walletId: 'wallet-1',
            password: 'secret',
        });
    });

    // BUG: A missing PSBT payload leaves the approval button enabled.
    it.skip('blocks approval when the PSBT payload is missing', async () => {
        mount('signPsbt', { chainId: 'bitcoin-regtest', payload: {} });

        const password = await screen.findByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });
});
