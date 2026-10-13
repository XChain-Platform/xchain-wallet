// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const VALID_ADDRESS = 'bc1qdevmockabcdef';

function messagingFor({ address = VALID_ADDRESS, walletMode = 'full' } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getControllerActionClasses: vi.fn().mockResolvedValue({ actionClasses: ['transfer'] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        buildControllerBindParams: vi.fn().mockResolvedValue({ action: 'ADDRESS', params: {} }),
        composeForConfirm: vi.fn().mockResolvedValue({}),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mountController(options) {
    const messaging = messagingFor(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ControllerBindForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

function mountDelegation(options) {
    const messaging = messagingFor(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DelegationActionForm
                mode="delegate"
                walletId="wallet-1"
                chainId={CHAIN}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => cleanup());

describe('controller binding and signing-key delegation disclosures', () => {
    it('explains binding, unbinding, and review before signing', async () => {
        mountController();

        expect(await screen.findByText(/Binding lets a guard contract approve or block/)).toBeTruthy();
        expect(screen.getByText(/Use Unbind on this screen to remove the guard later/)).toBeTruthy();
        expect(screen.getByText(/review the source address, guard, action class, and fee before signing/)).toBeTruthy();
    });

    it('explains delegation, its revocation path, and review before signing', async () => {
        mountDelegation();

        expect(await screen.findByText(/Delegating lets the selected Ed25519 key sign hub actions/)).toBeTruthy();
        expect(screen.getByText(/Use Revoke delegation from the staking details to remove the key later/)).toBeTruthy();
        expect(screen.getByText(/review the source address, signing key, and fee before signing/)).toBeTruthy();
    });

    it.each([
        ['controller binding', mountController],
        ['delegation', mountDelegation],
    ])('shows the unsigned watch-only state on the initial %s form', async (_name, mount) => {
        mount({ walletMode: 'watcher' });

        expect(await screen.findByText(/Watch-only mode creates an unsigned transaction here and cannot sign it/)).toBeTruthy();
    });

    it.each([
        ['controller binding', mountController, 'Guard contract', '7', 'Bind'],
        ['delegation', mountDelegation, 'New signing pubkey', 'a'.repeat(64), 'Delegate signing key'],
    ])('rejects an invalid selected address before composing %s', async (
        _name,
        mount,
        inputLabel,
        inputValue,
        buttonLabel,
    ) => {
        const messaging = mount({ address: 'not-an-address' });
        fireEvent.change(await screen.findByLabelText(inputLabel), { target: { value: inputValue } });
        fireEvent.click(screen.getByRole('button', { name: buttonLabel }));

        expect(await screen.findByText('The selected source address is not valid for this network.')).toBeTruthy();
        await waitFor(() => {
            expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        });
    });
});
