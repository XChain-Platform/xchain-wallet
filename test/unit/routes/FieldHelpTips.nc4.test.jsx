// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN_ID = 'bitcoin-regtest';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qfieldhelptest000000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});

function messagingForController() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: ADDRESS }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getControllerActionClasses: vi.fn().mockResolvedValue({ actionClasses: ['transfer'] }),
        getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'ALPHA' }]),
        getTokenInfo: vi.fn().mockResolvedValue({ tick: 'ALPHA', creator: ADDRESS.address }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'available' }),
    };
    return new Proxy(messaging, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function renderControllerBind() {
    render(
        <MessagingProvider shell="web" messaging={messagingForController()}>
            <ControllerBindForm walletId="wallet-1" chainId={CHAIN_ID} tick="ALPHA" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function renderParallelComposer() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: ADDRESS }),
        listActions: vi.fn().mockResolvedValue(['SEND']),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={[{ chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0' } }]}
            />
        </MessagingProvider>,
    );
}

function helpTriggerBeside(label, accessibleName) {
    const labelNode = screen.getByText(label, { selector: 'span' });
    return within(labelNode.parentElement).getByRole('button', { name: accessibleName });
}

afterEach(() => cleanup());

describe('route field help tips', () => {
    it('puts token-specific help beside the Controller bind Token label', async () => {
        renderControllerBind();
        await screen.findByRole('button', { name: /^Token: ALPHA/ });

        const trigger = helpTriggerBeside('Token', 'About Token');
        expect(trigger).toHaveAttribute('aria-describedby');
        expect(screen.getByText('The token this wallet owns that the guard contract will approve or block actions for.'))
            .toBeTruthy();
    });

    it('puts row-specific help beside the Action queue Network label', async () => {
        renderParallelComposer();
        await screen.findByRole('form', { name: 'Compose parallel actions' });

        const trigger = helpTriggerBeside('Network', 'About Network');
        expect(trigger).toHaveAttribute('aria-describedby');
        expect(screen.getByText("The network this row's action is submitted on.")).toBeTruthy();
    });
});
