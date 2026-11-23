// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

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

vi.mock('../../../packages/core/src/shared/approval/index.js', () => mocks);
vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);

const heldAddresses = [
    { address: '1LegacyHeldAddress', addressType: 'p2pkh', source: 'hd' },
    { address: '3NestedSegwitHeldAddress', addressType: 'p2sh-p2wpkh', source: 'hd' },
    { address: 'bc1qNativeSegwitHeldAddress', addressType: 'p2wpkh', source: 'imported' },
    { address: 'bc1pTaprootHeldAddress', addressType: 'p2tr', source: 'hd' },
];

function makeSigner(signMessage) {
    const signer = new SoftwareSigner({
        id: 'software-1',
        displayName: 'Software wallet',
        chainRegistry: { get: () => ({ wifVersionByte: 0x80 }) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ auth: { signMessage } }) },
    });
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: new Uint8Array(64),
        importedWifs: new Map(),
        masterKey: null,
    });
    signer._resolveWifForEntry = vi.fn(() => 'wif');
    return signer;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

describe('login address picker', () => {
    it('offers every held signing address and sends the Taproot pick through BIP-322', async () => {
        const signMessage = vi.fn(() => 'taproot-signature');
        const signer = makeSigner(signMessage);
        vi.spyOn(window, 'close').mockImplementation(() => {});
        mocks.listWallets.mockResolvedValue([{ id: 'wallet-1', name: 'Wallet 1' }]);
        mocks.getAddressesByChain.mockResolvedValue({
            'bitcoin-mainnet': [
                ...heldAddresses,
                { address: 'bc1qWatchOnlyAddress', addressType: 'p2wpkh', source: 'watch-only' },
            ],
        });
        mocks.getSettings.mockResolvedValue({});
        mocks.resolveApproval.mockImplementation(async (_id, decision) => {
            const selected = heldAddresses.find(({ address }) => address === decision.address);
            await signer.signMessage({
                message: 'login challenge',
                chainId: decision.chainId,
                path: "m/86'/0'/0'/0/0",
                addressType: selected?.addressType,
            });
            return { resolved: true };
        });
        mocks.getAddressBalances.mockRejectedValue(new Error('not used by sign-in'));
        mocks.parsePsbt.mockResolvedValue(null);
        mocks.requoteNativeFee.mockResolvedValue(null);
        mocks.parseCoSign.mockResolvedValue(null);
        mocks.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
        mocks.describeAction.mockResolvedValue(null);
        mocks.getTokenInfo.mockResolvedValue(null);

        render(
            <SignApproval
                id="login-picker"
                kind="signIn"
                payload={{
                    origin: 'https://dapp.test',
                    payload: {
                        appId: 'dapp.test',
                        nonce: 'nonce-1',
                        addresses: [
                            ...heldAddresses.map(({ address }) => ({
                                address,
                                chainId: 'bitcoin-mainnet',
                            })),
                            { address: 'bc1qWatchOnlyAddress', chainId: 'bitcoin-mainnet' },
                        ],
                    },
                }}
                onReject={() => {}}
            />,
        );

        let trigger = await screen.findByRole('button', {
            name: `Sign in as: ${heldAddresses[0].address}`,
        });
        fireEvent.click(trigger);
        let picker = screen.getByRole('listbox', { name: 'Sign in as' });
        expect(within(picker).getAllByRole('option')).toHaveLength(heldAddresses.length);
        expect(within(picker).queryByRole('option', { name: /bc1qWatchOnlyAddress/ })).toBeNull();

        for (const { address } of heldAddresses) {
            fireEvent.click(within(picker).getByRole('option', {
                name: new RegExp(`^${address}`),
            }));
            trigger = screen.getByRole('button', { name: `Sign in as: ${address}` });
            if (address !== heldAddresses.at(-1).address) {
                fireEvent.click(trigger);
                picker = screen.getByRole('listbox', { name: 'Sign in as' });
            }
        }
        expect(trigger).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

        await waitFor(() => expect(mocks.resolveApproval).toHaveBeenCalledWith(
            'login-picker',
            {
                approved: true,
                walletId: 'wallet-1',
                password: 'password',
                address: 'bc1pTaprootHeldAddress',
                chainId: 'bitcoin-mainnet',
            },
        ));
        expect(signMessage).toHaveBeenCalledWith(
            'login challenge',
            'wif',
            { format: 'bip322-simple' },
        );
    });
});
