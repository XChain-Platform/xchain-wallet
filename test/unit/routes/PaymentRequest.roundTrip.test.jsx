// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { ADDRESS_PARAMS } from '../../../packages/core/src/shared/utils/addressValidation.js';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), clearToasts: vi.fn() }),
}));

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');
const { ScanRoute } = await import('../../../packages/core/src/shared/routes/ScanRoute.jsx');
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');

const registry = defaultRegistry();
const CHAINS = registry.supportedChains().filter((descriptor) => (
    ['bitcoin', 'litecoin', 'dogecoin'].includes(descriptor.coin)
    && ['mainnet', 'testnet', 'regtest'].includes(descriptor.networkKind)
));
const AMOUNT = '12.34567891';
const LABEL = 'Café savings 東京';
const NATIVE_TICK = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const bsc = base58check(sha256);

function recordFor(descriptor, prefix) {
    const version = ADDRESS_PARAMS[descriptor.coin][descriptor.networkKind].p2pkh;
    const marker = [...`${prefix}-${descriptor.id}`]
        .reduce((total, character) => total + character.charCodeAt(0), 0) % 256;
    return {
        id: `${prefix}-${descriptor.id}`,
        address: bsc.encode(new Uint8Array([version, ...new Uint8Array(20).fill(marker)])),
        addressType: descriptor.defaultAddressType,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        label: LABEL,
    };
}

function settingsFor(descriptor) {
    return {
        schemaVersion: 1,
        activeNetwork: descriptor.networkKind,
        fees: { [descriptor.id]: { strategy: 'normal' } },
        grace: { testSendThresholdSats: 0 },
    };
}

async function requestFromReceive(descriptor) {
    const address = recordFor(descriptor, 'receive');
    const messaging = {
        getSettings: vi.fn().mockResolvedValue(settingsFor(descriptor)),
        getAddressesByChain: vi.fn().mockResolvedValue({ [descriptor.id]: [address] }),
        getNewestAddress: vi.fn().mockResolvedValue(address),
    };

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive
                walletId={`receive-${descriptor.id}`}
                prefill={{ chainId: descriptor.id }}
            />
        </MessagingProvider>,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: /^Amount/ }), {
        target: { value: AMOUNT },
    });
    await waitFor(() => expect(qrToDataURL.mock.calls.some(([value]) => (
        value.startsWith(`${descriptor.uriScheme}:${address.address}?`)
        && value.includes(`amount=${AMOUNT}`)
    ))).toBe(true));
    const request = qrToDataURL.mock.calls.findLast(([value]) => (
        value.startsWith(`${descriptor.uriScheme}:${address.address}?`)
        && value.includes(`amount=${AMOUNT}`)
    ))[0];
    cleanup();
    return { address, request };
}

function scanRequest(request) {
    const onClassified = vi.fn();
    render(
        <ScanRoute
            chainRegistry={registry}
            onClassified={onClassified}
            onBack={vi.fn()}
        />,
    );
    fireEvent.change(screen.getByLabelText('Or paste it here'), {
        target: { value: request },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use pasted text' }));
    const outcome = onClassified.mock.calls[0]?.[0];
    cleanup();
    return outcome;
}

function sendMessaging(descriptor, source, initialDescriptor, initialSource) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [initialDescriptor.id]: [initialSource],
            [descriptor.id]: [source],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [initialDescriptor.id]: { id: initialSource.id, address: initialSource.address },
            [descriptor.id]: { id: source.id, address: source.address },
        }),
        getAddressBalances: vi.fn(async (chainId) => ({
            native: {
                tick: NATIVE_TICK[registry.get(chainId)?.coin],
                quantity: '100000000',
                divisibility: 8,
            },
            tokens: [],
        })),
        getSettings: vi.fn().mockResolvedValue(settingsFor(descriptor)),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[property] = stub;
            return stub;
        },
    });
}

async function pasteRequestIntoSend(descriptor, request) {
    const source = recordFor(descriptor, 'source');
    const initialDescriptor = CHAINS.find(({ id }) => id !== descriptor.id);
    const initialSource = recordFor(initialDescriptor, 'initial');
    render(
        <MessagingProvider
            shell="web"
            messaging={sendMessaging(descriptor, source, initialDescriptor, initialSource)}
        >
            <Send walletId={`send-${descriptor.id}`} onBack={vi.fn()} />
        </MessagingProvider>,
    );

    const to = await screen.findByLabelText(/^To$/);
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(initialSource.address));
    fireEvent.paste(to, { clipboardData: { getData: () => request } });
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(source.address));
    expect(to).toHaveValue(recordFor(descriptor, 'receive').address);
    expect(screen.getByLabelText(/^Amount \(/)).toHaveValue(AMOUNT);

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'ROUNDTRIP' } });
    expect(screen.getByLabelText('Memo (optional)')).toHaveValue(LABEL);
}

afterEach(() => {
    cleanup();
    qrToDataURL.mockClear();
    localStorage.clear();
});

describe('Receive payment request round trips', () => {
    it('covers each bundled chain and network', () => {
        expect(CHAINS.map(({ id }) => id).sort()).toEqual([
            'bitcoin-mainnet',
            'bitcoin-regtest',
            'bitcoin-testnet',
            'dogecoin-mainnet',
            'dogecoin-regtest',
            'dogecoin-testnet',
            'litecoin-mainnet',
            'litecoin-regtest',
            'litecoin-testnet',
        ]);
    });

    it.each(CHAINS)(
        '$id preserves address, 8-decimal amount, and unicode label through Scan and Send paste',
        async (descriptor) => {
            const { address, request } = await requestFromReceive(descriptor);
            expect(request).toContain(`label=${encodeURIComponent(LABEL)}`);

            expect(scanRequest(request)).toMatchObject({
                kind: 'send',
                address: address.address,
                amount: AMOUNT,
                chainId: descriptor.id,
                memo: LABEL,
            });

            await pasteRequestIntoSend(descriptor, request);
        },
    );
});
