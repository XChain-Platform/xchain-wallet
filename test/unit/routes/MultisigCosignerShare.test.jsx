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

const { MultisigCosignerShare } = await import(
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
    'cosigner-share-xpub',
    'cosigner-share-public-key',
    'cosigner-share-master-fingerprint',
    'cosigner-share-derivation-path',
];

function mount(props = {}) {
    return render(
        <MultisigCosignerShare walletId="wallet-1" addresses={ADDRESSES} {...props} />,
    );
}

function selectAddress(value = 'address-1') {
    fireEvent.change(screen.getByLabelText('Address to share'), {
        target: { value },
    });
}

function expectNoValues() {
    VALUE_TEST_IDS.forEach((testId) => {
        expect(screen.queryByTestId(testId)).toBeNull();
    });
}

beforeEach(() => {
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png,cosigner-share');
    messaging = { getMultisigCosignerInfo: vi.fn().mockResolvedValue(INFO) };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('MultisigCosignerShare address selection', () => {
    it('lists the placeholder and each address without inventing a label', () => {
        mount();

        const options = screen.getAllByRole('option');
        expect(options.map((option) => option.textContent.trim())).toEqual([
            'Select address',
            'bc1qlabelled · Savings',
            'bc1qunlabelled',
        ]);
        expect(messaging.getMultisigCosignerInfo).not.toHaveBeenCalled();
    });

    it('marks watch-only, hardware, and imported-key addresses unavailable', () => {
        mount({
            addresses: [
                { id: 'hd', address: 'bc1qhd', source: 'hd' },
                { id: 'watch', address: 'bc1qwatch', source: 'watch-only' },
                { id: 'trezor', address: 'bc1qtrezor', source: 'trezor' },
                { id: 'ledger', address: 'bc1qledger', source: 'ledger' },
                { id: 'wif', address: 'bc1qwif', source: 'imported-wif' },
            ],
        });

        const options = screen.getAllByRole('option');
        expect(options[1]).not.toBeDisabled();
        expect(options[2]).toBeDisabled();
        expect(options[2]).toHaveTextContent('watch-only, unavailable');
        expect(options[3]).toBeDisabled();
        expect(options[3]).toHaveTextContent('hardware, export on device');
        expect(options[4]).toBeDisabled();
        expect(options[5]).toBeDisabled();
        expect(screen.getByText(/Only software-seed addresses can be shared here/i)).toBeTruthy();
    });

    it('clears shared values when the placeholder is selected again', async () => {
        mount();
        selectAddress();
        expect(await screen.findByTestId('cosigner-share-xpub')).toBeTruthy();

        selectAddress('');

        await waitFor(expectNoValues);
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledTimes(1);
    });

    it('clears a shared address that is absent after the network changes', async () => {
        const view = mount();
        selectAddress();
        expect(await screen.findByTestId('cosigner-share-xpub')).toBeTruthy();

        view.rerender(
            <MultisigCosignerShare
                walletId="wallet-1"
                addresses={[{ id: 'testnet-address', address: 'tb1qtestnet' }]}
            />,
        );

        await waitFor(expectNoValues);
        expect(screen.getByLabelText('Address to share').value).toBe('');
    });

    it('hides the prior payload while a different address loads', async () => {
        let resolveSecond;
        messaging.getMultisigCosignerInfo
            .mockResolvedValueOnce(INFO)
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
        mount();
        selectAddress('address-1');
        expect(await screen.findByLabelText('Cosigner share payload')).toBeTruthy();

        selectAddress('address-2');

        expect(screen.queryByLabelText('Cosigner share payload')).toBeNull();
        expectNoValues();
        resolveSecond({ ...INFO, pubkey: '03abcdef' });
        expect(await screen.findByTestId('cosigner-share-public-key'))
            .toHaveTextContent('03abcdef');
    });
});

describe('MultisigCosignerShare key details', () => {
    it('shows the same complete public payload as QR and copyable text', async () => {
        mount({ networkKind: 'mainnet' });
        selectAddress();

        const text = await screen.findByLabelText('Cosigner share payload');
        const payload = JSON.parse(text.value);
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
        expect(screen.getByRole('button', { name: 'Copy cosigner share payload' })).toBeTruthy();
        expect(await screen.findByRole('img', {
            name: 'QR code for multisig cosigner share payload',
        })).toHaveAttribute('src', 'data:image/png,cosigner-share');
        expect(toDataURL).toHaveBeenCalledWith(text.value, expect.any(Object));
        expect(screen.getByRole('note')).toHaveTextContent(
            /compare the master fingerprint and derivation path.*separate trusted channel/i,
        );
    });

    it('loads and displays every returned value for the chosen address', async () => {
        mount();
        selectAddress('address-2');

        expect(await screen.findByTestId('cosigner-share-xpub')).toHaveTextContent(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key')).toHaveTextContent(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint')).toHaveTextContent(INFO.fingerprint);
        expect(screen.getByTestId('cosigner-share-derivation-path')).toHaveTextContent(INFO.derivationPath);
        expect(screen.getByText(`Account ${INFO.accountPath}`)).toBeTruthy();
        expect(screen.getByTestId('cosigner-share-xpub').style.overflowWrap).toBe('anywhere');
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
        selectAddress();

        const shared = await screen.findByTestId('cosigner-share-xpub');
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
        selectAddress();

        expect(await screen.findByText('Not available from this signer')).toBeTruthy();
        expect(screen.queryByTestId('cosigner-share-xpub')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Copy xpub' })).toBeNull();
        expect(screen.getByLabelText('Cosigner share payload')).not.toHaveValue(
            expect.stringContaining(privateAccount.privateExtendedKey),
        );
        expect(JSON.parse(screen.getByLabelText('Cosigner share payload').value).xpub).toBeNull();
    });

    it('marks an empty signer field as unavailable', async () => {
        messaging.getMultisigCosignerInfo.mockResolvedValue({
            ...INFO,
            pubkey: '',
        });
        mount();
        selectAddress();

        expect(await screen.findByText('Not available from this signer')).toBeTruthy();
        expect(screen.queryByTestId('cosigner-share-public-key')).toBeNull();
        expect(screen.getByTestId('cosigner-share-xpub')).toHaveTextContent(INFO.xpub);
    });
});

describe('MultisigCosignerShare failures', () => {
    it('shows a user-facing rejection without rendering key values', async () => {
        messaging.getMultisigCosignerInfo.mockRejectedValue(
            new Error('This signer is locked.'),
        );
        mount();
        selectAddress();

        expect(await screen.findByRole('alert')).toHaveTextContent('This signer is locked.');
        expectNoValues();
    });

    it('explains when the shell does not support cosigner sharing', async () => {
        messaging = {};
        mount();
        selectAddress();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Sharing cosigner keys is not available in this shell.',
        );
        expectNoValues();
    });
});
