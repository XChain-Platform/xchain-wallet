// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';
import { __clearSignerInfoCache } from '../../../packages/core/src/shared/hooks/useSignerInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'address-1',
    address: 'bc1qoperatoroperatoroperatoroperatoroperator',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const HW_OWNER = Object.freeze({ ...OWNER, id: 'address-hw', source: 'trezor', signerId: 'signer-hw' });
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'BROADCAST|3|700|123.45',
    version: 1,
    chainId: CHAIN,
    networkFeeSats: 1234,
    decoded: { summary: 'Publish 123.45 to feed 700', details: [], warnings: [] },
});
const PASS = Object.freeze({ verdict: 'pass', findings: [] });

afterEach(() => {
    cleanup();
    __clearSignerInfoCache();
});

function makeMessaging({
    owner = OWNER,
    rows = [{ action_index: '700', action_format: 2, block_index: 90, message: 'BTC/USD', status: 'valid' }],
    settings = { walletMode: 'full' },
    signerRows = [],
} = {}) {
    const methods = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [owner] }),
        getSettings: vi.fn().mockResolvedValue(settings),
        listSigners: vi.fn().mockResolvedValue(signerRows),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: owner.source === 'hd' ? 'unlocked' : 'available' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue({ data: rows }),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue(PASS),
        broadcastAction: vi.fn().mockResolvedValue({ txid: 'software-txid' }),
        broadcastActionHw: vi.fn().mockResolvedValue({ txid: 'hardware-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({
            psbtHex: 'bb00', encoding: 'psbt', fromAddress: owner.address, chainId: CHAIN,
        }),
        listWallets: vi.fn().mockResolvedValue([]),
        reserve: vi.fn().mockResolvedValue({ id: 'reservation-1' }),
        releaseReservation: vi.fn().mockResolvedValue(null),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'pass', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
    };
    const messaging = new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
    return { messaging, methods };
}

function mount(options) {
    const harness = makeMessaging(options);
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging: harness.messaging },
        React.createElement(OperatorDashboard, {
            walletId: 'wallet-1', chainId: CHAIN, address: OWNER.address, onBack() {},
        }),
    ));
    return harness;
}

async function openPublisher() {
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.queryByText('Loading source address…')).toBeNull());
}

async function publishValue(value = '123.45') {
    fireEvent.change(screen.getByLabelText('Value'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));
}

async function approve() {
    const button = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

describe('operator publisher feed field selection', () => {
    it('prefills the newest feed-create by action_format rather than an unrelated version field', async () => {
        mount({
            rows: [
                { action_index: '800', action_format: 3, version: 2, block_index: 100, value: '9' },
                {
                    action_index: '700', action_format: 2, version: 3,
                    block_index: 90, message: 'BTC/USD', status: 'valid',
                },
            ],
        });
        await openPublisher();

        expect(screen.getByLabelText('Feed reference number')).toHaveValue('700');
        expect(screen.getByText(/^v3/)).toBeTruthy();
    });

    it('skips an invalid newest feed-create in favor of the newest valid one', async () => {
        mount({
            rows: [
                { action_index: '800', action_format: 2, block_index: 100, status: 'invalid' },
                { ACTION_INDEX: '700', ACTION_FORMAT: '2', block_index: 90, STATUS: 'valid' },
            ],
        });
        await openPublisher();

        expect(screen.getByLabelText('Feed reference number')).toHaveValue('700');
    });
});

describe('operator publisher owner-action lane', () => {
    it('keeps the publish button active so it can explain a missing value', async () => {
        const { methods } = mount();
        await openPublisher();

        const button = screen.getByRole('button', { name: 'Publish value' });
        expect(button).toBeEnabled();
        fireEvent.click(button);

        expect(await screen.findByText('Value is required.')).toBeTruthy();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
        expect(methods.broadcastAction).not.toHaveBeenCalled();
    });

    it('preflights before software signing and signs the previewed bytes only after approval', async () => {
        const { methods } = mount();
        await openPublisher();
        await publishValue();

        await waitFor(() => expect(methods.composeForConfirm).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(methods.preflight).toHaveBeenCalledTimes(1));
        expect(methods.broadcastAction).not.toHaveBeenCalled();
        expect(screen.getByTestId('confirm-source')).toHaveTextContent(OWNER.address.slice(0, 6));
        expect(screen.getByTestId('confirm-source')).toHaveTextContent(OWNER.address.slice(-6));
        expect(screen.getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.00001234 BTC');
        expect(methods.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            actionData: {
                action: 'BROADCAST',
                params: { VERSION: '3', BROADCAST_ACTION_INDEX: '700', VALUE: '123.45' },
            },
        }));

        await approve();
        await waitFor(() => expect(methods.broadcastAction).toHaveBeenCalledTimes(1));
        expect(methods.broadcastAction.mock.invocationCallOrder[0])
            .toBeGreaterThan(methods.preflight.mock.invocationCallOrder[0]);
        expect(methods.broadcastAction).toHaveBeenCalledWith(expect.objectContaining({
            params: { VERSION: '3', BROADCAST_ACTION_INDEX: '700', VALUE: '123.45' },
            prebuiltPsbt: expect.objectContaining({ psbtHex: 'aa00', encoding: 'psbt' }),
        }));
    });

    it('shows house copy when compose reports an encoder refusal', async () => {
        const raw = new Error('ENCODER_NO_UTXOS: no spendable UTXOs found for the funding address');
        raw.name = 'SDKEncoderError';
        const { methods } = mount();
        methods.composeForConfirm.mockRejectedValueOnce(raw);
        await openPublisher();
        await publishValue();

        const text = (await screen.findByRole('alert')).textContent || '';
        expect(text).toContain('has no BTC to spend');
        expect(text).not.toContain('ENCODER_NO_UTXOS');
        expect(text).not.toContain('no spendable UTXOs');
        expect(methods.broadcastAction).not.toHaveBeenCalled();
    });

    it('rejects back to the form with the value intact and does not broadcast', async () => {
        const { methods } = mount();
        await openPublisher();
        await publishValue('456.78');

        fireEvent.click(await screen.findByTestId('confirm-reject'));

        await waitFor(() => expect(screen.queryByTestId('confirm-modal')).toBeNull());
        expect(screen.getByLabelText('Value')).toHaveValue('456.78');
        expect(methods.broadcastAction).not.toHaveBeenCalled();
        expect(methods.broadcastActionHw).not.toHaveBeenCalled();
    });
});

describe('operator publisher alternate signer modes', () => {
    it('shows the paired device firmware advisory on the confirm page', async () => {
        mount({
            owner: HW_OWNER,
            signerRows: [{
                id: 'signer-hw', vendor: 'trezor', model: 'T2T1', firmwareVersion: '2.5.0',
            }],
        });
        await openPublisher();
        await publishValue();

        expect(await screen.findByText('Firmware update recommended')).toBeTruthy();
    });

    it('preflights hardware publishing and sends the previewed bytes to the device lane', async () => {
        const { methods } = mount({ owner: HW_OWNER });
        await openPublisher();
        await publishValue();
        await approve();

        await waitFor(() => expect(methods.broadcastActionHw).toHaveBeenCalledTimes(1));
        expect(methods.broadcastAction).not.toHaveBeenCalled();
        expect(methods.broadcastActionHw.mock.invocationCallOrder[0])
            .toBeGreaterThan(methods.preflight.mock.invocationCallOrder[0]);
        expect(methods.broadcastActionHw).toHaveBeenCalledWith(expect.objectContaining({
            signerId: 'signer-hw',
            prebuiltPsbt: expect.objectContaining({ psbtHex: 'aa00' }),
        }));
    });

    it('builds and displays an unsigned transaction in watcher mode', async () => {
        const { methods } = mount({ settings: { walletMode: 'watcher' } });
        await openPublisher();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Create unsigned transaction' })).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: '123.45' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByLabelText('Unsigned transaction hex')).toHaveValue('bb00');
        expect(methods.buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            actionData: {
                action: 'BROADCAST',
                params: { VERSION: '3', BROADCAST_ACTION_INDEX: '700', VALUE: '123.45' },
            },
        }));
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
        expect(methods.broadcastAction).not.toHaveBeenCalled();
        expect(methods.broadcastActionHw).not.toHaveBeenCalled();
    });
});
