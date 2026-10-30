// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The amount field refuses typed digits past the coin's decimal places, but a
// payment link fills it directly. Compose keeps only the places the coin has,
// so Review must refuse an amount the payment cannot carry in full.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') } }));
vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), clearToasts: vi.fn() }),
    useSuppressSpamToastsOnConfirm: () => {},
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
const DEST = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

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

async function reviewLinkAmount(amount) {
    const ms = messaging(['bitcoin-mainnet']);
    render(
        <MessagingProvider shell="web" messaging={ms}>
            <Send walletId="w1" onBack={vi.fn()} prefill={{ address: DEST, amount, tick: 'BTC', chainId: 'bitcoin-mainnet' }} />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/^From$/)).toHaveValue(SOURCES['bitcoin-mainnet']));
    await screen.findByText(/BTC available/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Send' }).at(-1));
    // Wrapped: the stub proxy answers every property, then included.
    return { ms };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('link amount past the coin decimal places', () => {
    it('refuses nine decimal places on a BTC send', async () => {
        const { ms } = await reviewLinkAmount('0.123456789');
        expect(await screen.findAllByText(/Amount can have at most 8 decimal places\./)).not.toHaveLength(0);
        expect(ms.composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts eight decimal places', async () => {
        // The stub host composes nothing, so the confirm step reports a failure.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { ms } = await reviewLinkAmount('0.12345678');
        await waitFor(() => expect(ms.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.12345678' })));
        expect(screen.queryByText(/decimal places/)).toBeNull();
    });
});
