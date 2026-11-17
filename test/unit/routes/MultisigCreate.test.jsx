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
import { openSelectListbox, selectOption, selectOptionDetails, selectOptionLabels } from '../../helpers/selectOption.js';
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

async function mount(messaging, props = {}) {
    await act(async () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MultisigCreate, {
                walletId: 'w-1',
                onBack: () => {},
                onShare: () => {},
                ...props,
            }),
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

// The cosigner sections, in order, and the header button that folds one.
const cosignerSections = () => Array.from(document.querySelectorAll('section[data-form-section^="cosigner-"]'));
const toggleOf = (section) => section.querySelector('[data-form-section-toggle]');
const thresholdTrigger = () => screen.getByRole('button', { name: /^Signatures required:/ });
const thresholdLabels = () => selectOptionDetails(thresholdTrigger()).map((option) => option.label);

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

        const create = screen.getByRole('button', { name: 'Create Multisig' });
        expect(create).toHaveClass(buttonStyles.success);
        expect(create.querySelector('svg')).not.toBeNull();
        expect(create.querySelector('circle[cx="7.5"][cy="15.5"]')).not.toBeNull();
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

        expect(screen.getByRole('button', { name: 'About Signatures required' })).toBeTruthy();
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

        const share = screen.getByRole('button', { name: 'Share Wallet as Cosigner' });
        expect(share.querySelector('svg')).not.toBeNull();
        expect(share).toHaveAttribute('title', 'Share Wallet as Cosigner');
        expect(screen.getByRole('button', { name: 'Import Shared Setup' }).querySelector('svg')).not.toBeNull();
        for (const remove of screen.getAllByRole('button', { name: 'Remove' })) {
            expect(remove.querySelector('svg')).not.toBeNull();
            expect(remove).toHaveClass(buttonStyles.danger);
            expect(remove).toHaveClass(buttonStyles.block);
        }
    });

    it('shows the Type dropdown and removes the setup disclosure', async () => {
        await mount(mkMessaging());
        const type = screen.getByLabelText('Type');
        expect(selectOptionLabels(type)).toEqual(expect.arrayContaining(['Classic', 'SegWit', 'Taproot']));
        expect(screen.queryByText('How multisig setup works')).toBeNull();
        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
    });

    it('offers one "N of M" option per signer and follows the signer count', async () => {
        await mount(mkMessaging());
        expect(thresholdLabels()).toEqual(['1 of 2', '2 of 2']);
        // Every option carries an icon.
        const trigger = thresholdTrigger();
        const listbox = openSelectListbox(trigger);
        expect(Array.from(listbox.querySelectorAll('[role="option"]')).every((o) => o.querySelector('svg'))).toBe(true);
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Add Cosigner' }));
        expect(thresholdLabels()).toEqual(['1 of 3', '2 of 3', '3 of 3']);
        // The default choice of 2 stays while the group grows.
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 2 of 3');

        for (let i = 0; i < 2; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Add Cosigner' }));
        expect(thresholdLabels()).toEqual(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']);
    });

    it('clamps the signatures-required choice to the new signer count', async () => {
        await mount(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: 'Add Cosigner' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Cosigner' }));
        selectOption(thresholdTrigger(), '4');
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 4 of 4');

        // Drop two signers: 4 of 4 becomes 2 of 2.
        await act(async () => {
            fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[3]);
        });
        await act(async () => {
            fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
        });
        expect(thresholdLabels()).toEqual(['1 of 2', '2 of 2']);
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 2 of 2');
    });

    it('shows each cosigner kind in its section summary and ends with Add cosigner', async () => {
        await mount(mkMessaging());
        const [first, second] = cosignerSections();
        fireEvent.click(toggleOf(first));
        fireEvent.click(toggleOf(second));
        expect(toggleOf(first)).toHaveTextContent('You');
        expect(toggleOf(second)).toHaveTextContent('Someone else');

        fireEvent.click(toggleOf(second));
        selectOption(within(second).getByLabelText('Origin'), 'external-hardware');
        fireEvent.click(toggleOf(second));
        expect(toggleOf(second)).toHaveTextContent('Hardware');

        const list = screen.getByTestId('cosigners-list');
        const actions = list.nextElementSibling;
        expect(actions.firstElementChild).toBe(screen.getByRole('button', { name: 'Add Cosigner' }));
        expect(actions.lastElementChild).toBe(screen.getByRole('button', { name: 'Create Multisig' }));
    });

    it('draws Add Cosigner as the kit ghost Button, full width with a plus icon and no overriding class', async () => {
        await mount(mkMessaging());
        const add = screen.getByRole('button', { name: 'Add Cosigner' });
        expect(add.querySelector('svg')).not.toBeNull();
        const classes = add.className.split(/\s+/).filter(Boolean);
        expect(classes.some((c) => /ghost/i.test(c))).toBe(true);
        expect(classes.some((c) => /block/i.test(c))).toBe(true);
        expect(classes.some((c) => /rowAction/i.test(c))).toBe(false);
        // Only the kit's own classes: base, size, variant, block.
        expect(classes.every((c) => !/cosigner|styles/i.test(c))).toBe(true);
    });

    it('titles each section with the signer name and shows its address or key when collapsed', async () => {
        await mount(mkMessaging());
        await pickLocalAddress();
        await fillExternalCosigner();
        const [first, second] = cosignerSections();

        expect(toggleOf(first)).toHaveTextContent('My signer');
        expect(toggleOf(second)).toHaveTextContent('Cosigner B');
        fireEvent.click(toggleOf(first));
        fireEvent.click(toggleOf(second));
        // The summary address fits its line (jsdom has no width, so it shows
        // the first and last six); both ends of each key name the signer.
        for (const [section, key] of [[first, ADDRESS.address], [second, EXTERNAL.xpub]]) {
            expect(toggleOf(section)).toHaveTextContent(key.slice(0, 6));
            expect(toggleOf(section)).toHaveTextContent(key.slice(-6));
        }
    });

    it('collapses and reopens any signer without touching the others', async () => {
        await fillValidDraft(mkMessaging());
        const [first, second] = cosignerSections();
        // Every signer starts open, and nothing folds when its last field becomes valid.
        expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'true');
        expect(toggleOf(second)).toHaveAttribute('aria-expanded', 'true');
        expect(within(second).getByLabelText('Origin')).toBeVisible();

        fireEvent.click(toggleOf(first));
        expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'false');
        expect(toggleOf(second)).toHaveAttribute('aria-expanded', 'true');
        expect(within(first).getByLabelText('Origin')).not.toBeVisible();
        expect(within(second).getByLabelText('Origin')).toBeVisible();
        // The folded signer keeps what was typed.
        expect(within(first).getAllByLabelText(/Master fingerprint/i)[0]).toHaveValue('73c5da0a');

        fireEvent.click(toggleOf(first));
        expect(within(first).getByLabelText('Origin')).toBeVisible();
    });

    it('opens a folded signer that still has a problem when Create is refused', async () => {
        await mount(mkMessaging());
        const [first, second] = cosignerSections();
        fireEvent.click(toggleOf(first));
        fireEvent.click(toggleOf(second));
        expect(toggleOf(second)).toHaveAttribute('aria-expanded', 'false');

        fireEvent.submit(screen.getByRole('button', { name: 'Create Multisig' }).closest('form'));
        expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'true');
        expect(toggleOf(second)).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens a new signer and holds no card inside a card', async () => {
        await mount(mkMessaging());
        fireEvent.click(screen.getByRole('button', { name: 'Add Cosigner' }));
        const added = cosignerSections()[2];
        expect(toggleOf(added)).toHaveAttribute('aria-expanded', 'true');
        expect(toggleOf(added)).toHaveTextContent('Cosigner C');
        expect(screen.queryByTestId('cosigners-card')).toBeNull();
        expect(added.parentElement.closest('section[data-form-section]')).toBeNull();
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
        selectOption(origins[1], 'local');
        await act(async () => {});
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
        fireEvent.click(screen.getByRole('button', { name: /Import Shared Setup/ }));

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
        fireEvent.click(screen.getByRole('button', { name: /Import Shared Setup/ }));

        expect(screen.getByText('Shared cosigner setup is for a different network than this wallet.')).toBeTruthy();
    });

    it('keeps the signatures-required choice within 1 and the cosigner count', async () => {
        await mount(mkMessaging());
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 2 of 2');
        selectOption(thresholdTrigger(), '1');
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 1 of 2');
        expect(selectOptionDetails(thresholdTrigger()).map((option) => option.value)).toEqual(['1', '2']);
    });

    it('opens without an error, then reports missing cosigner fields when Create is tapped', async () => {
        const messaging = mkMessaging();
        await mount(messaging);

        expect(screen.queryByText(/public key must be 66 characters starting with 02 or 03/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        const create = screen.getByRole('button', { name: 'Create Multisig' });
        expect(create).not.toBeDisabled();
        fireEvent.click(create);

        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent(/public key must be 66 characters starting with 02 or 03/i));
        expect(screen.getAllByLabelText(/^Public key$/i)[0]).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.createMultisigConfig).not.toHaveBeenCalled();
    });

    it('keeps the errors of untouched fields silent while another field is typed', async () => {
        await mount(mkMessaging());
        await act(async () => {
            fireEvent.change(screen.getAllByLabelText(/^Name/i)[0], { target: { value: 'Alice' } });
        });
        expect(screen.queryByText(/public key must be 66 characters starting with 02 or 03/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create Multisig' }).disabled).toBe(false);

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
        expect(screen.getByRole('button', { name: 'Create Multisig' }).disabled).toBe(false);
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
        selectOption(thresholdTrigger(), '1');
        selectOption(screen.getByLabelText('Type'), 'taproot-musig2');
        expect(thresholdTrigger()).toHaveAccessibleName('Signatures required: 2 of 2');
        const options = selectOptionDetails(thresholdTrigger());
        expect(options.map((option) => option.disabled)).toEqual([true, false]);
    });

    it('enforces the classic script limit on N', async () => {
        await mount(mkMessaging());
        const add = screen.getByRole('button', { name: /Add Cosigner/ });
        await act(async () => {
            for (let i = 0; i < 14; i += 1) fireEvent.click(add);
        });
        // The pick opens the list and clicks an option, so it runs outside act.
        selectOption(screen.getByLabelText('Type'), 'p2sh-multisig');
        await act(async () => {});

        expect(screen.getByText(/supports at most 15 cosigners/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Add Cosigner/ }).disabled).toBe(true);
    });
});

describe('MultisigCreate review', () => {
    it('returns from review without submitting the compose form again', async () => {
        const messaging = mkMessaging();
        await fillValidDraft(messaging);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Create Multisig' }));
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
            fireEvent.click(screen.getByRole('button', { name: 'Create Multisig' }));
        });

        expect(messaging.createMultisigConfig).not.toHaveBeenCalled();
        expect(screen.getByText(/2-of-2 SegWit/i)).toBeTruthy();
        const reviewedXpub = screen.getByText(EXTERNAL.xpub);
        expect(reviewedXpub.className).toContain('reviewKey');
        expect(screen.getByText(EXTERNAL.pubkey)).toBeTruthy();

        const confirm = screen.getByRole('button', { name: 'Confirm Multisig' });
        expect(confirm).toHaveClass(buttonStyles.success);
        expect(confirm.querySelector('svg')).not.toBeNull();
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Multisig' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Create Multisig' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
        // The sections come back as the user left them: open, with every value kept.
        expect(cosignerSections().map((section) => toggleOf(section).getAttribute('aria-expanded')))
            .toEqual(['true', 'true']);

        expect(screen.getByLabelText(/^Account public key$/i)).toHaveValue(EXTERNAL.xpub);
        expect(screen.getAllByLabelText(/^Public key$/i)[1]).toHaveValue(EXTERNAL.pubkey);
        expect(screen.getAllByLabelText(/Master fingerprint/i)[1]).toHaveValue('11223344');
        expect(screen.getAllByLabelText(/^Account path/i)[1]).toHaveValue(EXTERNAL.path);
    });

    it('review display matches the built config by showing canonical keys and numeric threshold', async () => {
        await fillValidDraft(mkMessaging());
        selectOption(thresholdTrigger(), '1');
        selectOption(thresholdTrigger(), '2');
        fireEvent.change(screen.getAllByLabelText(/^Public key$/i)[1], {
            target: { value: EXTERNAL.pubkey.toUpperCase() },
        });
        fireEvent.change(screen.getAllByLabelText(/Master fingerprint/i)[1], {
            target: { value: 'AABBCCDD' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create Multisig' }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Create Multisig' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm Multisig' }));

        const alert = await screen.findByRole('alert');
        consoleError.mockRestore();
        expect(alert).toHaveTextContent(
            'Failed to create multisig configuration.',
        );
        expect(screen.queryByText(/createMultisigConfig|encoder exploded/i)).toBeNull();
    });
});

describe('MultisigCreate share as cosigner', () => {
    it('removes the disclosure and opens the dedicated page from the header action', async () => {
        const messaging = mkMessaging();
        const onShare = vi.fn();
        await mount(messaging, { onShare });

        expect(screen.queryByText(/Joining someone else's multisig/i)).toBeNull();
        expect(screen.queryByLabelText('Address to share')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Share Wallet as Cosigner' }));
        expect(onShare).toHaveBeenCalledTimes(1);
    });
});
