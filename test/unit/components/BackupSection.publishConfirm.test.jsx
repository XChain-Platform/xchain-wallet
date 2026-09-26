// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qlabelbackupfrom00000000000000000000000',
    publicKey: '03'.padEnd(66, 'b'),
    derivationPath: "m/84'/0'/0'/0/2",
    source: 'hd',
};
const PREPARATION = {
    chainId: CHAIN_ID,
    from: FROM,
    actionData: {
        action: 'FILE',
        params: {
            VERSION: '0',
            NAME: 'label-discovery-name',
            TYPE: 'application/octet-stream',
            TITLE: 'wallet-labels',
            MEMO: '',
        },
    },
    encoderOpts: {
        rawData: 'aabbccdd',
        sourceAddress: FROM.address,
        change: FROM.address,
    },
    discoveryName: 'label-discovery-name',
    sizeBytes: 4,
};
const COMPOSED = {
    actionString: 'FILE|0|label-discovery-name|application/octet-stream|wallet-labels|',
    action: 'FILE',
    version: 0,
    psbt: 'label-commit-psbt',
    encoding: 'TAPROOT',
    revealPsbt: { psbtHex: 'label-reveal-psbt' },
    envelope: { kind: 'taproot', commitAddress: 'bc1penvelope' },
    expectedOutputs: { addressed: [], encoding: 'TAPROOT' },
    tamperVerified: true,
};

afterEach(() => cleanup());

function mount(overrides = {}) {
    const messaging = {
        labelSyncStatusRequest: vi.fn(async () => ({ due: false })),
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: false })),
        prepareLabelsRequest: vi.fn(async () => PREPARATION),
        composeForConfirm: vi.fn(async () => COMPOSED),
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        requoteNativeFee: vi.fn(async () => null),
        reserve: vi.fn(async () => {}),
        releaseReservation: vi.fn(async () => {}),
        publishLabelsRequest: vi.fn(async () => ({
            txid: 'label-txid',
            chainId: CHAIN_ID,
            discoveryName: PREPARATION.discoveryName,
            sizeBytes: PREPARATION.sizeBytes,
            fromAddress: FROM.address,
        })),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('BackupSection label publication confirmation', () => {
    it('confirms and dry-runs the prepared FILE envelope before publication', async () => {
        const messaging = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        await waitFor(() => expect(messaging.prepareLabelsRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            password: 'secret',
            chainId: CHAIN_ID,
        }));
        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith(expect.objectContaining({
            actionString: COMPOSED.actionString,
            source: FROM.address,
        })));
        expect(messaging.publishLabelsRequest).not.toHaveBeenCalled();
        expect(screen.getByLabelText(FROM.address)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(messaging.publishLabelsRequest).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            password: 'secret',
            chainId: CHAIN_ID,
            preparation: PREPARATION,
            prebuiltPsbt: expect.objectContaining({
                psbtHex: COMPOSED.psbt,
                revealPsbt: COMPOSED.revealPsbt,
                envelope: COMPOSED.envelope,
            }),
        })));
        expect(await screen.findByText('✓ Labels published')).toBeTruthy();
    });

    it('clears the label-backup password when confirmation is rejected', async () => {
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

        await waitFor(() => expect(screen.getByLabelText('Wallet password')).toHaveValue(''));
    });

    it('clears the label-backup password when preparation fails', async () => {
        mount({ prepareLabelsRequest: vi.fn(async () => { throw new Error('compose failed'); }) });

        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(await screen.findByText('compose failed')).toBeTruthy();
        expect(screen.getByLabelText('Wallet password')).toHaveValue('');
    });

    it('does not prefill the label-backup password after a successful publish', async () => {
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));
        fireEvent.change(await screen.findByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));

        expect(await screen.findByLabelText('Wallet password')).toHaveValue('');
    });
});
