// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ControllerBindForm } from '../../../packages/core/src/shared/routes/ControllerBindForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const FIRST = Object.freeze({
    id: 'address-1',
    address: 'bc1qdevmock02aabbcc',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});
const SECOND = Object.freeze({
    id: 'address-2',
    address: 'bc1qdevmock03aabbcc',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
});

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FIRST, SECOND] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getControllerActionClasses: vi.fn().mockResolvedValue({
            actionClasses: ['transfer', 'trade', 'burn', 'mint', 'stake', 'ownership', 'all'],
        }),
        getOwnedTokens: vi.fn(({ address }) => Promise.resolve(
            address === FIRST.address ? [{ tick: 'ALPHA' }] : [{ tick: 'BETA' }],
        )),
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve({
            tick,
            creator: tick === 'BETA' ? SECOND.address : FIRST.address,
        })),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'available' }),
        buildControllerBindParams: vi.fn((request) => Promise.resolve({
            action: request.target === 'token' ? 'ISSUE' : 'ADDRESS',
            params: { ACTION_CLASS: request.actionClass },
        })),
        advancedAction: vi.fn(({ params }) => Promise.resolve({ txid: `tx-${params.ACTION_CLASS}` })),
        // The tracker already lists the change of every bind these tests send.
        getAddressUtxos: vi.fn().mockResolvedValue([
            { txid: 'tx-transfer', vout: 1 },
            { txid: 'tx-burn', vout: 1 },
        ]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00',
            actionString: 'ADDRESS|1|7|transfer||0|',
            chainId: CHAIN,
            decoded: { action: 'ADDRESS', summary: 'Bind controller', details: [], warnings: [] },
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount({ tick, overrides } = {}) {
    const messaging = messagingFor(overrides);
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ControllerBindForm walletId="wallet-1" chainId={CHAIN} tick={tick} onBack={() => {}} />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

async function fillMultiClassBind() {
    fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('burn'));
    fireEvent.click(screen.getByRole('button', { name: 'Bind address' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'one password' } });
}

afterEach(() => cleanup());

describe('ControllerBindForm multi-class binds', () => {
    it('requires at least one action class', async () => {
        mount();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.click(screen.getByLabelText('transfer'));
        fireEvent.click(screen.getByRole('button', { name: 'Bind address' }));

        expect(await screen.findByText('Choose at least one action class.')).toBeTruthy();
    });

    it('sends two classes in order with one password and retries only the failed class', async () => {
        const failure = new Error('burn broadcast failed');
        const advancedAction = vi.fn()
            .mockResolvedValueOnce({ txid: 'tx-transfer' })
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({ txid: 'tx-burn' });
        const { messaging } = mount({ overrides: { advancedAction } });
        await fillMultiClassBind();

        fireEvent.click(screen.getByRole('button', { name: 'Sign: bind controller' }));

        await waitFor(() => expect(advancedAction).toHaveBeenCalledTimes(2));
        expect(messaging.buildControllerBindParams.mock.calls.slice(0, 2).map(([request]) => request.actionClass))
            .toEqual(['transfer', 'burn']);
        expect(advancedAction.mock.calls.slice(0, 2).map(([request]) => request.password))
            .toEqual(['one password', 'one password']);
        // The second bind is composed only after the first one's outputs are visible.
        expect(messaging.getAddressUtxos).toHaveBeenCalledWith(CHAIN, advancedAction.mock.calls[0][0].from.address);
        expect(messaging.getAddressUtxos.mock.invocationCallOrder[0])
            .toBeLessThan(messaging.buildControllerBindParams.mock.invocationCallOrder[1]);
        expect(messaging.getAddressUtxos.mock.invocationCallOrder[0])
            .toBeGreaterThan(advancedAction.mock.invocationCallOrder[0]);
        expect(await screen.findByText(/Sent: tx-transfer/)).toBeTruthy();
        expect(screen.getByText(/Failed:/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Sign: bind controller' }));
        await waitFor(() => expect(advancedAction).toHaveBeenCalledTimes(3));
        expect(messaging.buildControllerBindParams.mock.calls.map(([request]) => request.actionClass))
            .toEqual(['transfer', 'burn', 'burn']);
        expect(advancedAction.mock.calls[2][0].password).toBe('one password');
        expect(await screen.findByText('Bind sequence completed. The network will apply each controller change shortly.')).toBeTruthy();
    });

    it('keeps one class on the shared confirm path exactly once', async () => {
        const { messaging } = mount();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind address' }));

        expect(await screen.findByTestId('confirm-modal')).toBeTruthy();
        expect(messaging.buildControllerBindParams).toHaveBeenCalledTimes(1);
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('opens the Token picker, lists only owned tokens, and switches to the picked token owner', async () => {
        mount({ tick: 'NOTOWNED' });
        const token = await screen.findByRole('button', { name: /^Token:/ });

        expect(token).toHaveAccessibleName(/^Token: ALPHA/);
        expect(document.body.textContent).not.toContain('does not own');
        fireEvent.click(token);

        expect(await screen.findByRole('heading', { name: 'Select token' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'ALPHA' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'BETA' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'NOTOWNED' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'BETA' }));

        expect(await screen.findByRole('button', { name: /^Token: BETA/ })).toBeTruthy();
        expect(await screen.findByDisplayValue(SECOND.address)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Bind token' })).toBeTruthy();
    });

    it('uses target-specific labels and the Controller link icon', async () => {
        const tokenView = mount({ tick: 'ALPHA' });
        const tokenButton = await screen.findByRole('button', { name: 'Bind token' });
        expect(tokenButton.querySelector('svg')).toBeTruthy();
        tokenView.unmount();

        mount();
        const addressButton = await screen.findByRole('button', { name: 'Bind address' });
        expect(addressButton.querySelector('svg')).toBeTruthy();
    });

    it('puts form-specific help on From, target, and Action class and marks cooldown optional', async () => {
        mount();

        expect(await screen.findByRole('button', { name: 'About From' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About What to protect' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Action class' })).toBeTruthy();
        expect(screen.queryByText('How controller bindings work')).toBeNull();
        expect(document.querySelector('details')).toBeNull();

        const cooldown = screen.getByLabelText('Cooldown blocks');
        const describedBy = cooldown.getAttribute('aria-describedby').split(' ');
        expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toContain('Optional');
        expect(screen.queryByText(/Cooldown blocks \(optional\)/i)).toBeNull();
    });
});
