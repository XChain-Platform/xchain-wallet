// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HDKey } from '@scure/bip32';

let messaging;
const toDataURL = vi.hoisted(() => vi.fn());

vi.mock('qrcode', () => ({ default: { toDataURL } }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ onPick }) => (
        <section aria-label="Address picker">
            {ADDRESSES.map((address) => (
                <button key={address.id} type="button" onClick={() => onPick(address)}>
                    Pick {address.id}
                </button>
            ))}
        </section>
    ),
}));

const { MultisigCosignerShare, unavailableAddressReason } = await import(
    '../../../packages/core/src/shared/routes/MultisigCosignerShare.jsx');

const ADDRESSES = [
    { id: 'address-1', address: 'bc1qlabelled', label: 'Savings' },
    { id: 'address-2', address: 'bc1qunlabelled' },
];

const INFO = {
    xpub: 'xpub-example',
    pubkey: '02abcdef',
    fingerprint: '73c5da0a',
    derivationPath: "m/84'/0'/0'/0/0",
    accountPath: "m/84'/0'/0'",
};

const VALUE_TEST_IDS = [
    'cosigner-share-account-public-key',
    'cosigner-share-public-key',
    'cosigner-share-master-fingerprint',
    'cosigner-share-account-path',
];

function mount({ addresses = ADDRESSES, networkKind = 'mainnet' } = {}) {
    messaging.getAddressesByChain.mockResolvedValue({
        [`bitcoin-${networkKind}`]: addresses,
    });
    return render(
        <MultisigCosignerShare walletId="wallet-1" onBack={() => {}} />,
    );
}

async function selectAddress(value = 'address-1') {
    fireEvent.click(await screen.findByRole('button', { name: 'Choose address to share' }));
    fireEvent.click(screen.getByRole('button', { name: `Pick ${value}` }));
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
}

function expectNoValues() {
    VALUE_TEST_IDS.forEach((testId) => {
        expect(screen.queryByTestId(testId)).toBeNull();
    });
}

beforeEach(() => {
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png,cosigner-share');
    messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': ADDRESSES }),
        getMultisigCosignerInfo: vi.fn().mockResolvedValue(INFO),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('MultisigCosignerShare address selection', () => {
    it('shows the page notice, read-only address field, and green Share action', async () => {
        mount();

        expect(await screen.findByRole('heading', { name: 'Share Wallet as Cosigner' })).toBeTruthy();
        expect(screen.getByText('Share Public Keys')).toBeTruthy();
        const field = screen.getByLabelText('Address to share');
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('placeholder', 'Select address');
        expect(screen.queryByRole('combobox', { name: 'Address to share' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Choose address to share' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Share' }).querySelector('svg')).not.toBeNull();
        expect(messaging.getMultisigCosignerInfo).not.toHaveBeenCalled();
    });

    it('keeps the unavailable reason for every unsupported signer type', async () => {
        expect(unavailableAddressReason({ source: 'hd' })).toBeNull();
        expect(unavailableAddressReason({ source: 'watch-only' })).toBe('No key, unavailable');
        expect(unavailableAddressReason({ source: 'trezor' })).toBe('Hardware, export on device');
        expect(unavailableAddressReason({ source: 'ledger' })).toBe('Hardware, export on device');
        expect(unavailableAddressReason({ source: 'imported-wif' })).toBe('Imported key, unavailable');
        mount();
        expect(await screen.findByText(/Only addresses from a software wallet can be shared here/i)).toBeTruthy();
    });

    it('reports the missing address at the top and on the field', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
        expect(await screen.findAllByText('Choose an address to share.')).toHaveLength(2);
        expect(screen.getByLabelText('Address to share')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.getMultisigCosignerInfo).not.toHaveBeenCalled();
    });

    it('hides the prior payload while a different address loads', async () => {
        let resolveSecond;
        messaging.getMultisigCosignerInfo
            .mockResolvedValueOnce(INFO)
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        mount();
        await selectAddress('address-1');
        expect(await screen.findByRole('img', {
            name: 'QR code for multisig cosigner share details',
        })).toBeTruthy();

        await selectAddress('address-2');

        expect(screen.queryByRole('img', {
            name: 'QR code for multisig cosigner share details',
        })).toBeNull();
        expectNoValues();
        resolveSecond({ ...INFO, pubkey: '03abcdef' });
        expect(await screen.findByTestId('cosigner-share-public-key'))
            .toHaveTextContent('03abcdef');
    });
});

describe('MultisigCosignerShare key details', () => {
    it('keeps the complete public payload in the QR and copy action without rendering network text', async () => {
        mount({ networkKind: 'mainnet' });
        await selectAddress();

        await waitFor(() => expect(toDataURL).toHaveBeenCalled());
        const payloadText = toDataURL.mock.calls.at(-1)[0];
        const payload = JSON.parse(payloadText);
        expect(payload).toEqual({
            type: 'xchain-multisig-cosigner',
            version: 1,
            network: 'mainnet',
            address: 'bc1qlabelled',
            xpub: INFO.xpub,
            pubkey: INFO.pubkey,
            fingerprint: INFO.fingerprint,
            derivationPath: INFO.derivationPath,
        });
        expect(screen.getByRole('button', { name: 'Copy Cosigner Share Details' })).toBeTruthy();
        const qr = await screen.findByRole('img', {
            name: 'QR code for multisig cosigner share details',
        });
        expect(qr).toHaveAttribute('src', 'data:image/png,cosigner-share');
        expect(qr).toHaveAttribute('width', '256');
        expect(qr).toHaveStyle({ width: '100%', maxWidth: '256px', height: 'auto' });
        expect(qr).toHaveStyle({ background: '#FFFFFF' });
        expect(toDataURL).toHaveBeenCalledWith(payloadText, {
            errorCorrectionLevel: 'M',
            margin: 4,
            width: 256,
            color: { dark: '#000000', light: '#FFFFFF' },
        });
        expect(screen.queryByLabelText('Cosigner share details')).toBeNull();
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        expect(screen.getByText(/Identity check:/i)).toHaveTextContent(
            /compare the master fingerprint and account path shown above.*separate trusted channel/i,
        );
    });

    it('rejects keys returned for an address other than the selected address', async () => {
        messaging.getMultisigCosignerInfo.mockResolvedValue({
            ...INFO,
            addressId: 'address-2',
            address: 'bc1qwrongaddress',
        });
        mount({ networkKind: 'mainnet' });
        await selectAddress('address-1');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The wallet returned cosigner keys for a different address.',
        );
        expect(screen.queryByLabelText('Cosigner share details')).toBeNull();
        expectNoValues();
    });

    it('loads and displays every returned value for the chosen address', async () => {
        mount();
        await selectAddress('address-2');

        expect(await screen.findByTestId('cosigner-share-account-public-key')).toHaveTextContent(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key')).toHaveTextContent(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint')).toHaveTextContent(INFO.fingerprint);
        expect(screen.getByTestId('cosigner-share-account-path')).toHaveTextContent(INFO.derivationPath);
        expect(screen.getByText(`Account ${INFO.accountPath}`)).toBeTruthy();
        expect(screen.getByTestId('cosigner-share-account-public-key').style.overflowWrap).toBe('anywhere');
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledTimes(1);
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressId: 'address-2',
        });
    });

    it('shares a testnet-serialized xpub on a test network', async () => {
        const mainnetAccount = HDKey.fromMasterSeed(new Uint8Array(32).fill(3))
            .derive("m/84'/0'/0'");
        messaging.getMultisigCosignerInfo.mockResolvedValue({
            ...INFO,
            xpub: mainnetAccount.publicExtendedKey,
        });
        mount({ networkKind: 'testnet' });
        await selectAddress();

        const shared = await screen.findByTestId('cosigner-share-account-public-key');
        expect(shared.textContent.startsWith('tpub')).toBe(true);
        expect(shared.textContent).not.toBe(mainnetAccount.publicExtendedKey);
    });

    it('never renders or copies an extended private key returned by a host', async () => {
        const privateAccount = HDKey.fromMasterSeed(new Uint8Array(32).fill(4))
            .derive("m/84'/0'/0'");
        messaging.getMultisigCosignerInfo.mockResolvedValue({
            ...INFO,
            xpub: privateAccount.privateExtendedKey,
        });
        mount({ networkKind: 'mainnet' });
        await selectAddress();

        expect(await screen.findByText('Not available from this address')).toBeTruthy();
        expect(screen.queryByTestId('cosigner-share-account-public-key')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Copy Account public key' })).toBeNull();
        await waitFor(() => expect(toDataURL).toHaveBeenCalled());
        const payloadText = toDataURL.mock.calls.at(-1)[0];
        expect(payloadText).not.toContain(privateAccount.privateExtendedKey);
        expect(JSON.parse(payloadText).xpub).toBeNull();
    });

    it('marks an empty signer field as unavailable', async () => {
        messaging.getMultisigCosignerInfo.mockResolvedValue({
            ...INFO,
            pubkey: '',
        });
        mount();
        await selectAddress();

        expect(await screen.findByText('Not available from this address')).toBeTruthy();
        expect(screen.queryByTestId('cosigner-share-public-key')).toBeNull();
        expect(screen.getByTestId('cosigner-share-account-public-key')).toHaveTextContent(INFO.xpub);
    });
});

describe('MultisigCosignerShare failures', () => {
    it('shows a user-facing rejection without rendering key values', async () => {
        messaging.getMultisigCosignerInfo.mockRejectedValue(
            new Error('This signer is locked.'),
        );
        mount();
        await selectAddress();

        expect(await screen.findByRole('alert')).toHaveTextContent('This signer is locked.');
        expectNoValues();
    });

    it('explains when the shell does not support cosigner sharing', async () => {
        messaging = { getAddressesByChain: vi.fn() };
        mount();
        await selectAddress();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Sharing cosigner keys is not available in this shell.',
        );
        expectNoValues();
    });
});
