// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An `xchain:<address>` payment link names no chain, but its address does when
// only one supported chain accepts it. Pasted into To on another chain, the
// link moves Send to the address's chain, the chain the scanner and an opened
// link pick, instead of reading the amount in the open coin.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

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
const SOURCES = {
    'bitcoin-mainnet': 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    'litecoin-mainnet': 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9',
};
const NATIVE = { 'bitcoin-mainnet': 'BTC', 'litecoin-mainnet': 'LTC' };
const LTC_DEST = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function messaging(chainIds) {
    const record = (id) => ({
        id: `src-${id}`,
        address: SOURCES[id],
        addressType: registry.get(id).defaultAddressType,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        label: 'x',
    });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(Object.fromEntries(chainIds.map((id) => [id, [record(id)]]))),
        getActiveAddresses: vi.fn().mockResolvedValue(Object.fromEntries(chainIds.map((id) => [
            id, { id: record(id).id, address: record(id).address },
        ]))),
        getAddressBalances: vi.fn(async (chainId) => ({
            native: { tick: NATIVE[chainId], quantity: '100000000', divisibility: 8 },
            tokens: [],
        })),
        getSettings: vi.fn().mockResolvedValue({
            schemaVersion: 1,
            activeNetwork: 'mainnet',
            lastUsedChainId: chainIds[0],
            fees: Object.fromEntries(chainIds.map((id) => [id, { strategy: 'normal' }])),
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

async function pasteLink(text, chainIds) {
    render(
        <MessagingProvider shell="web" messaging={messaging(chainIds)}>
            <Send walletId="w1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
    const to = await screen.findByLabelText(/^To$/);
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCES[chainIds[0]]));
    fireEvent.paste(to, { clipboardData: { getData: () => text } });
    return to;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('xchain: address link pasted on another chain', () => {
    it('moves Send to the chain the address belongs to', async () => {
        const to = await pasteLink(`xchain:${LTC_DEST}?amount=2`, ['bitcoin-mainnet', 'litecoin-mainnet']);
        await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCES['litecoin-mainnet']));
        expect(to).toHaveValue(LTC_DEST);
        expect(screen.getByLabelText('Token')).toHaveValue('LTC');
        expect(screen.getByLabelText(/^Amount \(LTC\)/)).toHaveValue('2');
    });

    it('stays on the open chain when the wallet has no address on the link chain', async () => {
        const to = await pasteLink(`xchain:${LTC_DEST}?amount=2`, ['bitcoin-mainnet']);
        await waitFor(() => expect(to).toHaveValue(LTC_DEST));
        expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCES['bitcoin-mainnet']);
    });
});
