// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The create flow validates every cosigner before presenting an explicit
// review. Local key material stays tied to the selected Bitcoin network, and
// external xpubs must derive the public key shown in the review.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { HDKey } from '@scure/bip32';
import { MultisigCreate } from '../../../packages/core/src/shared/routes/MultisigCreate.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const MAINNET_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };
const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };

function externalKey(versions = TESTNET_VERSIONS, fill = 7) {
    const account = HDKey.fromMasterSeed(new Uint8Array(32).fill(fill), versions)
        .derive("m/48'/0'/0'");
    const child = account.derive('m/0/0');
    return {
        xpub: account.publicExtendedKey,
        pubkey: Array.from(child.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
        path: "m/48'/0'/0'/0/0",
    };
}

const EXTERNAL = externalKey();
const MAINNET_EXTERNAL = externalKey(MAINNET_VERSIONS);
const OWN_OTHER = externalKey(TESTNET_VERSIONS, 9);
const UNRELATED_EXTERNAL = externalKey(TESTNET_VERSIONS, 11);

const ADDRESS = {
    id: 'addr-1',
    address: 'tb1qlocalcosigner',
    label: '',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/1'/0'/0/0",
    signerId: null,
};

const OTHER_OWN_ADDRESS = {
    id: 'addr-2',
    address: 'tb1qotherlocalcosigner',
    label: '',
    publicKey: OWN_OTHER.pubkey,
    derivationPath: OWN_OTHER.path,
    signerId: null,
};

const MAINNET_ADDRESS = {
    ...ADDRESS,
    id: 'addr-mainnet',
    address: 'bc1qlocalcosigner',
    derivationPath: "m/84'/0'/0'/0/0",
};

const INFO = {
    fingerprint: '73c5da0a',
    derivationPath: "m/84'/1'/0'/0/0",
    accountPath: "m/84'/1'/0'",
    xpub: 'xpub6ExampleAccountKey',
    pubkey: '02'.padEnd(66, 'a'),
    addressId: 'addr-1',
    address: 'tb1qlocalcosigner',
};

function mkMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn(async () => ({ 'bitcoin-testnet': [ADDRESS] })),
        getMultisigCosignerInfo: vi.fn(async () => INFO),
        createMultisigConfig: vi.fn(async () => ({})),
        ...overrides,
    };
}

async function mount(messaging) {
    await act(async () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MultisigCreate, { walletId: 'w-1', onBack: () => {} }),
        ));
    });
}

async function pickLocalAddress() {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(/Use one of this wallet's addresses/i), { target: { value: 'addr-1' } });
    });
}

async function fillExternalCosigner(key = EXTERNAL) {
    const publicKeys = screen.getAllByLabelText(/Public key \(hex/i);
    const fingerprints = screen.getAllByLabelText(/Master fingerprint/i);
    const paths = screen.getAllByLabelText(/^Derivation path/i);
    await act(async () => {
        fireEvent.change(screen.getByLabelText(/^xpub$/i), { target: { value: key.xpub } });
        fireEvent.change(publicKeys[1], { target: { value: key.pubkey } });
        fireEvent.change(fingerprints[1], { target: { value: '11223344' } });
        fireEvent.change(paths[1], { target: { value: key.path } });
    });
}

async function fillValidDraft(messaging) {
    await mount(messaging);
    await pickLocalAddress();
    await fillExternalCosigner();
}

afterEach(() => cleanup());

describe('MultisigCreate local cosigner', () => {
    it('describes Bitcoin support without exposing internal specification text', async () => {
        await mount(mkMessaging());
        expect(screen.getByText(/currently available only on Bitcoin networks/i)).toBeTruthy();
        expect(screen.queryByText(/§10\.3/)).toBeNull();
    });

    it('auto-fills the master fingerprint from the unlocked wallet', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        await pickLocalAddress();

        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledWith({ walletId: 'w-1', addressId: 'addr-1' });
        const [localFingerprint] = screen.getAllByLabelText(/Master fingerprint/i);
        expect(localFingerprint.value).toBe('73c5da0a');
        const [localPubkey] = screen.getAllByLabelText(/Public key \(hex/i);
        expect(localPubkey.value).toBe(ADDRESS.publicKey);
    });

    it('leaves the fingerprint editable with the reason when the read fails', async () => {
        const messaging = mkMessaging({
            getMultisigCosignerInfo: vi.fn(async () => { throw new Error('This wallet\'s keys are not unlocked in this session.'); }),
        });
        await mount(messaging);
        await pickLocalAddress();

        const [localFingerprint] = screen.getAllByLabelText(/Master fingerprint/i);
        expect(localFingerprint.value).toBe('');
        expect(screen.getByText(/Enter it by hand/)).toBeTruthy();
    });

    it('refuses a second local cosigner in the form', async () => {
        await mount(mkMessaging());
        const origins = screen.getAllByLabelText(/^Origin/i);
        await act(async () => {
            fireEvent.change(origins[1], { target: { value: 'local' } });
        });
        expect(screen.getByText(/Only one cosigner can be this wallet's own key/)).toBeTruthy();
    });

    it('rejects a local address left over from another selected network', async () => {
        const messaging = mkMessaging({
            getAddressesByChain: vi.fn(async () => ({
                'bitcoin-mainnet': [MAINNET_ADDRESS],
                'bitcoin-testnet': [ADDRESS],
            })),
        });
        await mount(messaging);
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/Use one of this wallet's addresses/i), {
                target: { value: 'addr-mainnet' },
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Network:/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('option', { name: /Bitcoin BTC.*testnet/i }));
        });

        expect(screen.getByText(/select a local address on the chosen network/i)).toBeTruthy();
    });
});

describe('MultisigCreate key validation', () => {
    it('rejects a compressed-looking value that is not a secp256k1 point', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: '03'.padEnd(66, 'b') });

        expect(screen.getByText(/public key must be a 33-byte compressed key/i)).toBeTruthy();
    });

    it('rejects duplicate public keys before review', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: ADDRESS.publicKey });

        expect(screen.getByText(/Two cosigners share the same public key/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });

    it('rejects another key owned by the current wallet as external', async () => {
        const messaging = mkMessaging({
            getAddressesByChain: vi.fn(async () => ({
                'bitcoin-testnet': [ADDRESS, OTHER_OWN_ADDRESS],
            })),
        });
        await mount(messaging);
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: OTHER_OWN_ADDRESS.publicKey });

        expect(screen.getByText(/one of the current wallet's own keys/i)).toBeTruthy();
    });

    it('rejects a mainnet xpub on the selected test network', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner(MAINNET_EXTERNAL);

        expect(screen.getByText(/xpub is for Bitcoin mainnet, not this test network/i)).toBeTruthy();
    });

    it('rejects a public key that the entered xpub does not derive', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: UNRELATED_EXTERNAL.pubkey });

        expect(screen.getByText(/Public key does not match the xpub and derivation path/i)).toBeTruthy();
    });

    it('enforces M no greater than N', async () => {
        await mount(mkMessaging());
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/Threshold/i), { target: { value: '3' } });
        });

        expect(screen.getByText(/Threshold must be ≤ cosigner count/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });

    it('enforces the classic script limit on N', async () => {
        await mount(mkMessaging());
        const add = screen.getByRole('button', { name: /Add cosigner/i });
        await act(async () => {
            for (let i = 0; i < 14; i += 1) fireEvent.click(add);
            fireEvent.click(screen.getByRole('radio', { name: /^Classic multi-signature/i }));
        });

        expect(screen.getByText(/supports at most 15 cosigners/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Add cosigner/i }).disabled).toBe(true);
    });
});

describe('MultisigCreate review', () => {
    it('reviews the complete policy before creating it and wraps long keys', async () => {
        const messaging = mkMessaging({
            createMultisigConfig: vi.fn(async (request) => ({
                wallet: { name: 'Shared wallet' },
                config: {
                    scheme: request.scheme,
                    threshold: request.threshold,
                    cosigners: request.cosigners,
                },
            })),
        });
        await fillValidDraft(messaging);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        });

        expect(messaging.createMultisigConfig).not.toHaveBeenCalled();
        expect(screen.getByText(/2-of-2 SegWit multi-signature/i)).toBeTruthy();
        const reviewedXpub = screen.getByText(EXTERNAL.xpub);
        expect(reviewedXpub.style.overflowWrap).toBe('anywhere');
        expect(screen.getByText(EXTERNAL.pubkey)).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm multisig' }));
        });

        expect(messaging.createMultisigConfig).toHaveBeenCalledTimes(1);
        expect(messaging.createMultisigConfig).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-testnet',
            scheme: 'p2wsh-multisig',
            threshold: 2,
        }));
    });
});

describe('MultisigCreate share as cosigner', () => {
    it('shows the xpub, pubkey, fingerprint and path for a chosen address', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/Address to share/i), { target: { value: 'addr-1' } });
        });

        expect(screen.getByTestId('cosigner-share-xpub').textContent).toBe(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key').textContent).toBe(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint').textContent).toBe('73c5da0a');
        expect(screen.getByTestId('cosigner-share-derivation-path').textContent).toBe(INFO.derivationPath);
        expect(screen.getByRole('button', { name: 'Copy xpub' })).toBeTruthy();
    });
});
