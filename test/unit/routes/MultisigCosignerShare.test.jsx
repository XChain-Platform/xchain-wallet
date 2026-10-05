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

let messaging;

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

function mount() {
    return render(
        <MultisigCosignerShare walletId="wallet-1" addresses={ADDRESSES} />,
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

    it('clears shared values when the placeholder is selected again', async () => {
        mount();
        selectAddress();
        expect(await screen.findByTestId('cosigner-share-xpub')).toBeTruthy();

        selectAddress('');

        await waitFor(expectNoValues);
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledTimes(1);
    });
});

describe('MultisigCosignerShare key details', () => {
    it('loads and displays every returned value for the chosen address', async () => {
        mount();
        selectAddress('address-2');

        expect(await screen.findByTestId('cosigner-share-xpub')).toHaveTextContent(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key')).toHaveTextContent(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint')).toHaveTextContent(INFO.fingerprint);
        expect(screen.getByTestId('cosigner-share-derivation-path')).toHaveTextContent(INFO.derivationPath);
        expect(screen.getByText(`Account ${INFO.accountPath}`)).toBeTruthy();
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledTimes(1);
        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressId: 'address-2',
        });
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
