// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { ProjectRosterForm } from '../../../packages/core/src/shared/routes/ProjectRosterForm.jsx';

const CHAIN_ID = 'dogecoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'DFromAddressForPasswordClearTest',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/3'/0'/0/0",
    source: 'hd',
};
const COMPOSED = {
    psbt: 'confirm-psbt',
    encoding: 'P2WSH',
    actionString: 'ACTION|0',
    version: '0',
    expectedOutputs: { addressed: [], encoding: 'P2WSH' },
    tamperVerified: true,
    gatedPublish: {
        actionData: { action: 'BATCH', params: { VERSION: '0', COMMAND: 'FILE|0' } },
        keyHash: 'a'.repeat(64),
        ciphertextLength: 32,
    },
};

afterEach(() => cleanup());

function messagingWith(overrides = {}) {
    return {
        getSettings: vi.fn(async () => ({ walletMode: 'full', activeNetwork: 'mainnet' })),
        signerReady: vi.fn(async () => ({ ready: false })),
        getSignerStatus: vi.fn(async () => ({ status: 'locked' })),
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: { id: FROM.id } })),
        listGatedKeys: vi.fn(async () => []),
        getGenesisForToken: vi.fn(async () => ({ action_index: 77 })),
        getProjectForToken: vi.fn(async () => null),
        composeGatedPublishForConfirm: vi.fn(async () => COMPOSED),
        composeForConfirm: vi.fn(async () => COMPOSED),
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        requoteNativeFee: vi.fn(async () => null),
        reserve: vi.fn(async () => {}),
        releaseReservation: vi.fn(async () => {}),
        ...overrides,
    };
}

function mount(Component, props, messaging = messagingWith()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>,
    );
}

async function rejectConfirmation() {
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'secret' } });
    const submit = screen.getByRole('button', { name: /Sign and publish|Publish list/ });
    fireEvent.click(submit);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
}

describe('confirmation password cleanup', () => {
    it('clears GatedPublishForm password after Reject', async () => {
        mount(GatedPublishForm, {
            walletId: 'wallet-1', chainId: CHAIN_ID, tick: 'GATE', onBack() {},
        });
        const file = new File(['content'], 'gated.txt', { type: 'text/plain' });
        fireEvent.change(await screen.findByLabelText('File to publish'), { target: { files: [file] } });
        await screen.findByText(/gated\.txt/);
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await rejectConfirmation();
    });

    it('clears ProjectRosterForm password after Reject', async () => {
        mount(ProjectRosterForm, {
            walletId: 'wallet-1', chainId: CHAIN_ID, tick: 'PROJ', onBack() {},
        });
        fireEvent.change(await screen.findByLabelText('Tokens (one per line)'), {
            target: { value: 'MEMBER' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review list' }));

        await rejectConfirmation();
    });
});
