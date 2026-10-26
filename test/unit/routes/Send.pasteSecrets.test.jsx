// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pasting into the To field never lands secret material there. The field's
// contents autosave to a plaintext form draft, so a private key or recovery
// phrase that reached it, bare or inside a payment link, would be stored.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { ADDRESS_PARAMS } from '../../../packages/core/src/shared/utils/addressValidation.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') } }));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), clearToasts: vi.fn() }),
}));
vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');

const registry = defaultRegistry();
const bsc = base58check(sha256);
const CHAIN = registry.get('bitcoin-mainnet');
const SOURCE = {
    id: 'src',
    address: bsc.encode(new Uint8Array([ADDRESS_PARAMS.bitcoin.mainnet.p2pkh, ...new Uint8Array(20).fill(9)])),
    addressType: CHAIN.defaultAddressType,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'x',
};
const WIF = bsc.encode(new Uint8Array([0x80, ...new Uint8Array(32).fill(3), 1]));
const PHRASE = generateBip39Mnemonic();

function messaging() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN.id]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN.id]: { id: SOURCE.id, address: SOURCE.address } }),
        getAddressBalances: vi.fn(async () => ({ native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] })),
        getSettings: vi.fn().mockResolvedValue({
            schemaVersion: 1,
            activeNetwork: 'mainnet',
            fees: { [CHAIN.id]: { strategy: 'normal' } },
            grace: { testSendThresholdSats: 0 },
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            target[property] = vi.fn().mockResolvedValue(null);
            return target[property];
        },
    });
}

async function pasteIntoTo(text) {
    render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <Send walletId="w1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
    const to = await screen.findByLabelText(/^To$/);
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCE.address));
    fireEvent.paste(to, { clipboardData: { getData: () => text } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return to;
}

function storedDrafts() {
    return Object.keys(localStorage)
        .filter((key) => key.startsWith('xc:formdraft'))
        .map((key) => localStorage.getItem(key))
        .join('|')
        .toLowerCase();
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('secret material pasted into the To field', () => {
    it.each([
        ['a bare private key', () => WIF],
        ['a private key as a payment link address', () => `bitcoin:${WIF}?amount=1`],
        ['a recovery phrase', () => PHRASE],
        ['an upper-case recovery phrase', () => PHRASE.toUpperCase()],
        ['a recovery phrase as a payment link address', () => `bitcoin:${PHRASE.replace(/ /g, '%20')}`],
    ])('keeps %s out of the field and the saved draft', async (_name, build) => {
        const to = await pasteIntoTo(build());
        expect(to).toHaveValue('');
        const drafts = storedDrafts();
        expect(drafts).not.toContain(WIF.toLowerCase());
        expect(drafts).not.toContain(PHRASE.split(' ')[0] + ' ' + PHRASE.split(' ')[1]);
        expect(drafts).not.toContain(PHRASE.split(' ')[0] + '%20' + PHRASE.split(' ')[1]);
    });

    it('still fills the field from an ordinary payment link', async () => {
        const to = await pasteIntoTo(`bitcoin:${SOURCE.address}?amount=1`);
        expect(to).toHaveValue(SOURCE.address);
    });
});
