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

function messagingFor({
    address = VALID_ADDRESS,
    walletMode = 'full',
    actionClasses,
    composeError,
    tokenInfo,
} = {}) {
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
        getControllerActionClasses: vi.fn(() => (
            actionClasses || Promise.resolve({ actionClasses: ['transfer'] })
        )),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo || { creator: address }),
        buildControllerBindParams: vi.fn().mockResolvedValue({ action: 'ADDRESS', params: {} }),
        composeForConfirm: composeError
            ? vi.fn().mockRejectedValue(composeError)
            : vi.fn().mockResolvedValue({
                psbt: 'aa00',
                actionString: 'ADDRESS|1|7|transfer||0|',
                chainId: CHAIN,
                decoded: {
                    action: 'ADDRESS',
                    summary: 'Bind controller',
                    details: [],
                    warnings: [],
                },
            }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mountController({ tick, onBack = () => {}, ...options } = {}) {
    const messaging = messagingFor(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ControllerBindForm walletId="wallet-1" chainId={CHAIN} tick={tick} onBack={onBack} />
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
    it('refuses a token controller change before review when the issuer is unknown', async () => {
        const messaging = mountController({ tick: 'CONTROLLED', tokenInfo: { creator: null } });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: 'Bind' })).toBeDisabled();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
    });

    it('keeps binding guidance in a collapsed disclosure', async () => {
        mountController();

        const disclosure = (await screen.findByText('How controller bindings work')).closest('details');
        expect(disclosure).toHaveProperty('open', false);
        expect(disclosure).toHaveTextContent(/guard contract approves or blocks/);
        expect(screen.queryByText(/review the source address, guard, action class, and fee before signing/)).toBeNull();
    });

    it('keeps delegation guidance in a collapsed disclosure', async () => {
        mountDelegation();

        const disclosure = (await screen.findByText('How signing-key delegation works')).closest('details');
        expect(disclosure).toHaveProperty('open', false);
        expect(disclosure).toHaveTextContent(/selected Ed25519 key can sign hub actions/);
        expect(screen.queryByText(/review the source address, signing key, and fee before signing/)).toBeNull();
    });

    it.each([
        ['controller binding', mountController],
        ['delegation', mountDelegation],
    ])('shows the unsigned watch-only state on the initial %s form', async (_name, mount) => {
        mount({ walletMode: 'watcher' });

        expect(await screen.findByText(/Watch-only mode creates an unsigned transaction and cannot sign it/)).toBeTruthy();
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

    it.each([
        ['empty', '', /Guard contract is required/],
        ['zero', '0', /positive whole action number/],
        ['negative', '-1', /positive whole action number/],
        ['decimal', '1.5', /positive whole action number/],
        ['malformed', '1e3', /positive whole action number/],
        ['out of range', '18446744073709551616', /no greater than 18446744073709551615/],
    ])('shows a plain %s guard contract error before compose', async (_name, value, message) => {
        const messaging = mountController();
        const field = await screen.findByLabelText('Guard contract');
        fireEvent.change(field, { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        ['negative', '-1', /non-negative whole number/],
        ['decimal', '1.5', /non-negative whole number/],
        ['out of range', '4294967296', /cannot be greater than 4294967295/],
    ])('shows a plain %s cooldown error before compose', async (_name, value, message) => {
        const messaging = mountController();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('Cooldown blocks (optional)'), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        expect(await screen.findByText(message)).toBeTruthy();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
    });

    it('validates the token name and memo before compose', async () => {
        const messaging = mountController({ tick: 'TWO WORDS' });
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
        expect(await screen.findByText(/Token can only use/)).toBeTruthy();

        cleanup();
        const nextMessaging = mountController();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'a|b' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
        expect(await screen.findByText('Memo cannot contain | or ; characters.')).toBeTruthy();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
        expect(nextMessaging.buildControllerBindParams).not.toHaveBeenCalled();
    });

    it('refuses an invalid custom fee instead of silently composing with the default', async () => {
        const messaging = mountController();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(await screen.findByLabelText(/Custom fee rate/), {
            target: { value: '0.123456789' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        expect(await screen.findByText('Custom network fee rate can have at most 8 decimal places.')).toBeTruthy();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
    });

    it('refuses review while action classes for the selected chain are stale', async () => {
        let resolveClasses;
        const actionClasses = new Promise((resolve) => { resolveClasses = resolve; });
        const messaging = mountController({ actionClasses });
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        expect(await screen.findByText(/Action classes are still refreshing/)).toBeTruthy();
        expect(messaging.buildControllerBindParams).not.toHaveBeenCalled();
        resolveClasses({ actionClasses: ['transfer'] });
    });

    it('keeps values when Back returns from the byte-exact confirm screen', async () => {
        mountController();
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '007' } });
        fireEvent.change(screen.getByLabelText('Cooldown blocks (optional)'), { target: { value: '000' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'keep me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        await screen.findByTestId('confirm-modal');
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByDisplayValue('007')).toBeTruthy();
        expect(screen.getByDisplayValue('000')).toBeTruthy();
        expect(screen.getByDisplayValue('keep me')).toBeTruthy();
    });

    it('shows watcher review values exactly as they are sent to the builder and keeps them on Back', async () => {
        const messaging = mountController({ walletMode: 'watcher' });
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '007' } });
        fireEvent.change(screen.getByLabelText('Cooldown blocks (optional)'), { target: { value: '000' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: ' note ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText('#007')).toBeTruthy();
        expect(screen.getByText('000 blocks')).toBeTruthy();
        expect(screen.getByText('note')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByDisplayValue('007')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        fireEvent.click(await screen.findByRole('button', {
            name: 'Create unsigned transaction: bind controller',
        }));
        await waitFor(() => expect(messaging.buildControllerBindParams).toHaveBeenCalled());
        expect(messaging.buildControllerBindParams.mock.calls.at(-1)[0]).toMatchObject({
            controller: '007',
            actionClass: 'transfer',
            cooldownBlocks: '000',
            memo: 'note',
        });
    });

    it('turns an insufficient-balance encoder failure into plain copy before confirm', async () => {
        const failure = Object.assign(
            new Error('no spendable UTXOs found for the funding address'),
            { name: 'SDKEncoderError', code: 'NO_UTXOS' },
        );
        const messaging = mountController({ composeError: failure });
        fireEvent.change(await screen.findByLabelText('Guard contract'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

        expect(await screen.findByText(/This address needs BTC for the protocol fee and the network fee/)).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/UTXO/i);
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });
});
