// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { HDKey } from '@scure/bip32';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN = 'bitcoin-testnet';
const LOCAL_ADDRESS = {
    id: 'address-local',
    address: 'tb1qlocalmultisig0000000000000000000000000',
    publicKey: `02${'a'.repeat(64)}`,
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};
const account = HDKey.fromMasterSeed(
    new Uint8Array(32).fill(7),
    { private: 0x04358394, public: 0x043587cf },
).derive("m/48'/1'/0'");
const externalChild = account.derive('m/0/0');
const EXTERNAL = {
    xpub: account.publicExtendedKey,
    pubkey: Array.from(externalChild.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    fingerprint: '11223344',
    path: "m/48'/1'/0'/0/0",
};

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, lockNetwork, onChainChange, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId} data-lock-network={String(Boolean(lockNetwork))}>
            {onChainChange ? <button type="button">Switch picker network</button> : null}
            <button type="button" onClick={() => onPick(LOCAL_ADDRESS)}>Pick local cosigner</button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigCreate } from '../../../packages/core/src/shared/routes/MultisigCreate.jsx';

afterEach(() => cleanup());

describe('MultisigCreate own-address picker', () => {
    it('keeps the local row on the multisig network and submits the picked key', async () => {
        const createMultisigConfig = vi.fn().mockResolvedValue({
            wallet: { name: 'Shared wallet' },
            config: { threshold: 2, cosigners: [{}, {}], scheme: 'p2wsh-multisig' },
        });
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [LOCAL_ADDRESS] }),
            getMultisigCosignerInfo: vi.fn().mockResolvedValue({ fingerprint: '73c5da0a' }),
            createMultisigConfig,
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MultisigCreate walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const field = await screen.findByLabelText("Use one of this wallet's addresses");
        expect(field).toHaveValue('');
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('placeholder', 'Select address');
        expect(screen.queryByRole('combobox', { name: "Use one of this wallet's addresses" })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: "Choose one of this wallet's addresses" }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN);
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-lock-network', 'true');
        expect(screen.queryByRole('button', { name: 'Switch picker network' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Pick local cosigner' }));

        expect(await screen.findByLabelText("Use one of this wallet's addresses")).toHaveValue(LOCAL_ADDRESS.address);
        await waitFor(() => expect(screen.getAllByLabelText('Master fingerprint')[0]).toHaveValue('73c5da0a'));
        const publicKeys = screen.getAllByLabelText('Public key');
        const fingerprints = screen.getAllByLabelText('Master fingerprint');
        const paths = screen.getAllByLabelText('Account path');
        fireEvent.change(screen.getByLabelText('Account public key'), { target: { value: EXTERNAL.xpub } });
        fireEvent.change(publicKeys[1], { target: { value: EXTERNAL.pubkey } });
        fireEvent.change(fingerprints[1], { target: { value: EXTERNAL.fingerprint } });
        fireEvent.change(paths[1], { target: { value: EXTERNAL.path } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Create multisig' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm multisig' }));

        await waitFor(() => expect(createMultisigConfig).toHaveBeenCalled());
        expect(createMultisigConfig.mock.calls[0][0]).toMatchObject({
            chainId: CHAIN,
            cosigners: [{ pubkey: LOCAL_ADDRESS.publicKey }, { pubkey: EXTERNAL.pubkey }],
        });
    });
});
