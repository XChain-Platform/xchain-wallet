// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A payment link's scheme names the coin its amount is written in. Testnet
// and regtest addresses of different coins share version bytes, so the
// address alone cannot say which coin the amount belongs to; the scheme does.
// Pasting a link whose scheme differs from the open chain moves Send to that
// coin on the same network instead of reading the amount in the open coin.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { ADDRESS_PARAMS } from '../../../packages/core/src/shared/utils/addressValidation.js';

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
const NATIVE = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
// A legacy testnet address: bitcoin and litecoin testnet share its version byte.
const SHARED_TESTNET_ADDRESS = bsc.encode(new Uint8Array([0x6f, ...new Uint8Array(20).fill(7)]));

function record(descriptor) {
    const version = ADDRESS_PARAMS[descriptor.coin][descriptor.networkKind].p2pkh;
    return {
        id: `src-${descriptor.id}`,
        address: bsc.encode(new Uint8Array([version, ...new Uint8Array(20).fill(Object.keys(NATIVE).indexOf(descriptor.coin) + 20)])),
        addressType: descriptor.defaultAddressType,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        label: 'x',
    };
}

function messaging(descriptors) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(Object.fromEntries(descriptors.map((d) => [d.id, [record(d)]]))),
        getActiveAddresses: vi.fn().mockResolvedValue(Object.fromEntries(descriptors.map((d) => [
            d.id, { id: record(d).id, address: record(d).address },
        ]))),
        getAddressBalances: vi.fn(async (chainId) => ({
            native: { tick: NATIVE[registry.get(chainId).coin], quantity: '100000000', divisibility: 8 },
            tokens: [],
        })),
        getSettings: vi.fn().mockResolvedValue({
            schemaVersion: 1,
            activeNetwork: 'testnet',
            lastUsedChainId: descriptors[0].id,
            fees: Object.fromEntries(descriptors.map((d) => [d.id, { strategy: 'normal' }])),
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

async function pasteLink(text, { open, others }) {
    const openDescriptor = registry.get(open);
    render(
        <MessagingProvider shell="web" messaging={messaging([openDescriptor, ...others.map((id) => registry.get(id))])}>
            <Send walletId="w1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
    const to = await screen.findByLabelText(/^To$/);
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(record(openDescriptor).address));
    fireEvent.paste(to, { clipboardData: { getData: () => text } });
    return to;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('payment link scheme against the open chain', () => {
    it('moves a bitcoin: link on a shared-format testnet address to bitcoin-testnet', async () => {
        const to = await pasteLink(`bitcoin:${SHARED_TESTNET_ADDRESS}?amount=1`, {
            open: 'litecoin-testnet',
            others: ['bitcoin-testnet'],
        });
        await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(record(registry.get('bitcoin-testnet')).address));
        expect(to).toHaveValue(SHARED_TESTNET_ADDRESS);
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('1');
        expect(screen.getByLabelText("Token")).toHaveValue("BTC");
        expect(screen.getByLabelText(/^Amount \(BTC\)/)).toBeTruthy();
    });

    it('keeps the open chain when the link scheme already matches it', async () => {
        const to = await pasteLink(`litecoin:${SHARED_TESTNET_ADDRESS}?amount=2`, {
            open: 'litecoin-testnet',
            others: ['bitcoin-testnet'],
        });
        await waitFor(() => expect(to).toHaveValue(SHARED_TESTNET_ADDRESS));
        expect(screen.getByLabelText(/^From$/)).toHaveValue(record(registry.get('litecoin-testnet')).address);
        expect(screen.getByLabelText("Token")).toHaveValue("LTC");
        expect(screen.getByLabelText(/^Amount \(LTC\)/)).toBeTruthy();
    });
});
