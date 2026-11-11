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
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import React from 'react';
import { HDKey } from '@scure/bip32';
import { clampThreshold, MultisigCreate } from '../../../packages/core/src/shared/routes/MultisigCreate.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick }) => (
        <button
            type="button"
            onClick={() => onPick(chainId === 'bitcoin-mainnet' ? MAINNET_ADDRESS : ADDRESS)}
        >
            Pick local address
        </button>
    ),
}));

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
    fireEvent.click(screen.getByRole('button', { name: "Choose one of this wallet's addresses" }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pick local address' }));
    await waitFor(() => {
        const fingerprint = screen.getAllByLabelText(/Master fingerprint/i)[0];
        const fallback = screen.queryByText(/Enter it by hand/);
        expect(Boolean(fingerprint.value) || Boolean(fallback)).toBe(true);
    });
}

async function fillExternalCosigner(key = EXTERNAL) {
    const publicKeys = screen.getAllByLabelText(/^Public key$/i);
    const fingerprints = screen.getAllByLabelText(/Master fingerprint/i);
    const paths = screen.getAllByLabelText(/^Account path/i);
    await act(async () => {
        fireEvent.change(screen.getByLabelText(/^Account public key$/i), { target: { value: key.xpub } });
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

describe('clampThreshold', () => {
    it('keeps 2 when the cosigner count grows from 3 to 4', () => {
        expect(clampThreshold({ chosen: 2, cosignerCount: 4, scheme: 'p2wsh-multisig' })).toBe(2);
    });

    it('drops 3 to 2 when the cosigner count falls from 3 to 2', () => {
        expect(clampThreshold({ chosen: 3, cosignerCount: 2, scheme: 'p2wsh-multisig' })).toBe(2);
    });

    it('returns the cosigner count for Taproot', () => {
        expect(clampThreshold({ chosen: 1, cosignerCount: 4, scheme: 'taproot-musig2' })).toBe(4);
    });
});

describe('MultisigCreate local cosigner', () => {
    it('uses the named success action and shows field-specific help and optional state', async () => {
        await mount(mkMessaging());

        const create = screen.getByRole('button', { name: 'Create multisig' });
        expect(create).toHaveClass(buttonStyles.success);
        expect(create.querySelector('svg')).not.toBeNull();
        expect(create.querySelector('circle[cx="7.5"][cy="15.5"]')).not.toBeNull();
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

        expect(screen.getByRole('button', { name: 'About signatures required' })).toBeTruthy();
        for (const label of [
            'Name',
            "Use one of this wallet's addresses",
            'Public key',
            'Master fingerprint',
            'Account path',
            'Shared cosigner setup',
            'Account public key',
        ]) {
            expect(screen.getAllByRole('button', { name: `About ${label}` }).length).toBeGreaterThan(0);
        }
        for (const help of [
            'Choose how many cosigners must approve each payment. Taproot requires every cosigner to approve.',
            'This label is visible only to you and helps you tell cosigners apart.',
            "Choose the address whose key this wallet adds as a cosigner.",
            "Enter the cosigner's compressed public key.",
            "Enter the 8-character fingerprint of the cosigner's wallet, used by signers to find their key.",
            "Enter the derivation path of the cosigner's key.",
            'Paste the setup another wallet shared to fill the fields below.',
            'Enter the xpub from the other wallet.',
        ]) {
            expect(screen.getAllByText(help).length).toBeGreaterThan(0);
        }

        const sharedSetup = screen.getByLabelText('Shared cosigner setup');
        const optionalPill = sharedSetup.closest('div').querySelector('[data-optional-pill]');
        expect(optionalPill).toHaveTextContent('Optional');
        expect(screen.queryByText(/\(optional\)/i)).toBeNull();

        const share = screen.getByRole('button', { name: /Joining someone else's multisig/i });
        expect(share.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Increase signatures required' }).querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Import shared setup' }).querySelector('svg')).not.toBeNull();
        expect(screen.getAllByRole('button', { name: 'Remove' })[0].querySelector('svg')).not.toBeNull();
    });

    it('shows the Type dropdown and removes the setup disclosure', async () => {
        await mount(mkMessaging());
        const type = screen.getByLabelText('Type');
        expect(within(type).getByRole('option', { name: 'Classic' })).toBeTruthy();
        expect(within(type).getByRole('option', { name: 'SegWit' })).toBeTruthy();
        expect(within(type).getByRole('option', { name: 'Taproot' })).toBeTruthy();
        expect(screen.queryByText('How multisig setup works')).toBeNull();
        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
    });

    it('updates the signatures-required count when a cosigner is added', async () => {
        await mount(mkMessaging());
        expect(screen.getByText('of 2 cosigners')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add cosigner' }));
        expect(screen.getByText('of 3 cosigners')).toBeTruthy();
        expect(screen.getByText('2', { selector: 'output' })).toBeTruthy();
    });

    it('shows each cosigner kind and ends the card with Add cosigner', async () => {
        await mount(mkMessaging());
        const rows = screen.getAllByRole('group', { name: /^Cosigner \d+$/ });
        expect(within(rows[0]).getByText('You')).toBeTruthy();
        expect(within(rows[1]).getByText('Someone else')).toBeTruthy();

        fireEvent.change(within(rows[1]).getByLabelText('Origin'), {
            target: { value: 'external-hardware' },
        });
        expect(within(rows[1]).getByText('Hardware')).toBeTruthy();

        const card = screen.getByTestId('cosigners-card');
        expect(card.lastElementChild).toBe(within(card).getByRole('button', { name: 'Add cosigner' }));
    });

    it('shows each selected address or key in full in its cosigner summary', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner();

        expect(screen.getByText(ADDRESS.address)).toBeTruthy();
        expect(screen.getByTitle(EXTERNAL.xpub)).toHaveTextContent(EXTERNAL.xpub);
    });

    it('folds a finished cosigner to its summary line and reopens it with Edit', async () => {
        await fillValidDraft(mkMessaging());
        const rows = screen.getAllByRole('group', { name: /^Cosigner \d+$/ });
        // Still open after the last field became valid: nothing folds under the cursor.
        expect(within(rows[1]).getByLabelText('Origin')).toBeTruthy();
        const done = within(rows[1]).getByRole('button', { name: 'Done editing cosigner 2' });
        expect(done.querySelector('svg')).not.toBeNull();
        fireEvent.click(done);
        expect(within(rows[1]).queryByLabelText('Origin')).toBeNull();
        expect(within(rows[1]).getByTitle(EXTERNAL.xpub)).toBeTruthy();
        const edit = within(rows[1]).getByRole('button', { name: 'Edit cosigner 2' });
        expect(edit.querySelector('svg')).not.toBeNull();
        fireEvent.click(edit);
        expect(within(rows[1]).getByLabelText('Origin')).toBeTruthy();
    });

    it('keeps an unfinished cosigner open with no fold control', async () => {
        await mount(mkMessaging());
        const rows = screen.getAllByRole('group', { name: /^Cosigner \d+$/ });
        expect(within(rows[1]).getByLabelText('Origin')).toBeTruthy();
        expect(within(rows[1]).queryByRole('button', { name: /cosigner 2$/ })).toBeNull();
    });

    it('auto-fills the master fingerprint from the unlocked wallet', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        await pickLocalAddress();

        expect(messaging.getMultisigCosignerInfo).toHaveBeenCalledWith({ walletId: 'w-1', addressId: 'addr-1' });
        const [localFingerprint] = screen.getAllByLabelText(/Master fingerprint/i);
        expect(localFingerprint.value).toBe('73c5da0a');
        const [localPubkey] = screen.getAllByLabelText(/^Public key$/i);
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
        await pickLocalAddress();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Network:/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Select Bitcoin testnet BTC' }));
        });

        expect(screen.getByText(/select a local address on the chosen network/i)).toBeTruthy();
    });
});

describe('MultisigCreate key validation', () => {
    it('round trips a shared cosigner setup into the editable key fields', async () => {
        await mount(mkMessaging());
        const payload = JSON.stringify({
            type: 'xchain-multisig-cosigner',
            version: 1,
            network: 'testnet',
            address: 'tb1qexternal',
            xpub: EXTERNAL.xpub,
            pubkey: EXTERNAL.pubkey,
            fingerprint: 'AABBCCDD',
            derivationPath: EXTERNAL.path,
        });
        fireEvent.change(screen.getByLabelText('Shared cosigner setup'), {
            target: { value: payload },
        });
        fireEvent.click(screen.getByRole('button', { name: /Import shared setup/i }));

        expect(screen.getByLabelText(/^Account public key$/i)).toHaveValue(EXTERNAL.xpub);
        expect(screen.getAllByLabelText(/^Public key$/i)[1]).toHaveValue(EXTERNAL.pubkey);
        expect(screen.getAllByLabelText(/Master fingerprint/i)[1]).toHaveValue('aabbccdd');
        expect(screen.getAllByLabelText(/^Account path/i)[1]).toHaveValue(EXTERNAL.path);
    });

    it('refuses a shared cosigner setup for another network with plain copy', async () => {
        await mount(mkMessaging());
        const payload = JSON.stringify({
            type: 'xchain-multisig-cosigner',
            version: 1,
            network: 'mainnet',
            xpub: MAINNET_EXTERNAL.xpub,
            pubkey: MAINNET_EXTERNAL.pubkey,
            fingerprint: 'aabbccdd',
            derivationPath: MAINNET_EXTERNAL.path,
        });
        fireEvent.change(screen.getByLabelText('Shared cosigner setup'), {
            target: { value: payload },
        });
        fireEvent.click(screen.getByRole('button', { name: /Import shared setup/i }));

        expect(screen.getByText('Shared cosigner setup is for a different network than this wallet.')).toBeTruthy();
    });

    it('keeps the signatures-required stepper within 1 and the cosigner count', async () => {
        await mount(mkMessaging());
        const decrease = screen.getByRole('button', { name: 'Decrease signatures required' });
        const increase = screen.getByRole('button', { name: 'Increase signatures required' });
        expect(increase).toBeDisabled();
        fireEvent.click(decrease);
        expect(screen.getByText('1', { selector: 'output' })).toBeTruthy();
        expect(decrease).toBeDisabled();
    });

    it('opens without an error message and keeps Create disabled', async () => {
        await mount(mkMessaging());

        expect(screen.queryByText(/public key must be 66 characters starting with 02 or 03/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create multisig' }).disabled).toBe(true);
    });

    it('keeps the errors of untouched fields silent while another field is typed', async () => {
        await mount(mkMessaging());
        await act(async () => {
            fireEvent.change(screen.getAllByLabelText(/^Name/i)[0], { target: { value: 'Alice' } });
        });
        expect(screen.queryByText(/public key must be 66 characters starting with 02 or 03/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create multisig' }).disabled).toBe(true);

        await act(async () => {
            fireEvent.blur(screen.getAllByLabelText(/^Public key$/i)[0]);
        });
        expect(screen.getByText(/Cosigner 1: public key must be 66 characters starting with 02 or 03/i)).toBeTruthy();
    });

    it('rejects a compressed-looking value that is not a secp256k1 point', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: '03'.padEnd(66, 'b') });

        expect(screen.getByText(/public key must be 66 characters starting with 02 or 03/i)).toBeTruthy();
    });

    it('rejects duplicate public keys before review', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner({ ...EXTERNAL, pubkey: ADDRESS.publicKey });

        expect(screen.getByText(/Two cosigners share the same public key/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create multisig' }).disabled).toBe(true);
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

    it('locks Taproot signatures to the cosigner count', async () => {
        await mount(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: 'Decrease signatures required' }));
        fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'taproot-musig2' } });
        expect(screen.getByText('2', { selector: 'output' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Decrease signatures required' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Increase signatures required' })).toBeDisabled();
    });

    it('enforces the classic script limit on N', async () => {
        await mount(mkMessaging());
        const add = screen.getByRole('button', { name: /Add cosigner/i });
        await act(async () => {
            for (let i = 0; i < 14; i += 1) fireEvent.click(add);
            fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'p2sh-multisig' } });
        });

        expect(screen.getByText(/supports at most 15 cosigners/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Add cosigner/i }).disabled).toBe(true);
    });
});

describe('MultisigCreate review', () => {
    it('returns from review without submitting the compose form again', async () => {
        const messaging = mkMessaging();
        await fillValidDraft(messaging);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));
        });
        expect(screen.getByRole('form', { name: 'Review multisig' })).toBeTruthy();

        let clickAllowed;
        await act(async () => {
            clickAllowed = fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        });

        expect(clickAllowed).toBe(false);
        expect(screen.getByRole('form', { name: 'Create multisig' })).toBeTruthy();
        expect(screen.queryByRole('form', { name: 'Review multisig' })).toBeNull();
        expect(messaging.createMultisigConfig).not.toHaveBeenCalled();
    });

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
            fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));
        });

        expect(messaging.createMultisigConfig).not.toHaveBeenCalled();
        expect(screen.getByText(/2-of-2 SegWit/i)).toBeTruthy();
        const reviewedXpub = screen.getByText(EXTERNAL.xpub);
        expect(reviewedXpub.className).toContain('reviewKey');
        expect(screen.getByText(EXTERNAL.pubkey)).toBeTruthy();

        const confirm = screen.getByRole('button', { name: 'Confirm multisig' });
        expect(confirm).toHaveClass(buttonStyles.success);
        expect(confirm.querySelector('svg')).not.toBeNull();
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

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

    it('returns from review with every entered value kept', async () => {
        await fillValidDraft(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        // Finished cosigners come back folded to their summary; open the second one.
        fireEvent.click(screen.getByRole('button', { name: 'Edit cosigner 2' }));

        expect(screen.getByLabelText(/^Account public key$/i)).toHaveValue(EXTERNAL.xpub);
        expect(screen.getAllByLabelText(/^Public key$/i)[0]).toHaveValue(EXTERNAL.pubkey);
        expect(screen.getAllByLabelText(/Master fingerprint/i)[0]).toHaveValue('11223344');
        expect(screen.getAllByLabelText(/^Account path/i)[0]).toHaveValue(EXTERNAL.path);
    });

    it('review display matches the built config by showing canonical keys and numeric threshold', async () => {
        await fillValidDraft(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: 'Decrease signatures required' }));
        fireEvent.click(screen.getByRole('button', { name: 'Increase signatures required' }));
        fireEvent.change(screen.getAllByLabelText(/^Public key$/i)[1], {
            target: { value: EXTERNAL.pubkey.toUpperCase() },
        });
        fireEvent.change(screen.getAllByLabelText(/Master fingerprint/i)[1], {
            target: { value: 'AABBCCDD' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));

        expect(await screen.findByText(/2-of-2 SegWit/i)).toBeTruthy();
        expect(screen.queryByText(/02-of-2/)).toBeNull();
        expect(screen.getByText(EXTERNAL.pubkey)).toBeTruthy();
        expect(screen.getByText('aabbccdd')).toBeTruthy();
    });

    it('shows plain copy when config creation rejects the reviewed values', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mkMessaging({
            createMultisigConfig: vi.fn(async () => {
                throw new Error('createMultisigConfig: encoder exploded');
            }),
        });
        await fillValidDraft(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Create multisig' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm multisig' }));

        const alert = await screen.findByRole('alert');
        consoleError.mockRestore();
        expect(alert).toHaveTextContent(
            'Failed to create multisig configuration.',
        );
        expect(screen.queryByText(/createMultisigConfig|encoder exploded/i)).toBeNull();
    });
});

describe('MultisigCreate share as cosigner', () => {
    it('shows the xpub, pubkey, fingerprint and path for a chosen address', async () => {
        const messaging = mkMessaging();
        await mount(messaging);
        fireEvent.click(screen.getByRole('button', { name: /Joining someone else's multisig/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose address to share' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick local address' }));

        expect((await screen.findByTestId('cosigner-share-account-public-key')).textContent).toBe(INFO.xpub);
        expect(screen.getByTestId('cosigner-share-public-key').textContent).toBe(INFO.pubkey);
        expect(screen.getByTestId('cosigner-share-master-fingerprint').textContent).toBe('73c5da0a');
        expect(screen.getByTestId('cosigner-share-account-path').textContent).toBe(INFO.derivationPath);
        expect(screen.getByRole('button', { name: 'Copy Account public key' })).toBeTruthy();
    });
});
