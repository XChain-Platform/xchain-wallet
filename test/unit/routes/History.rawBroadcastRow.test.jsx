// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A raw broadcast has no known sender. Its pending row names the transaction by
// its txid and carries a plain label, never the literal "unknown".

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: 1, fiatCurrency: 'EUR' }),
}));

const { EntryRow } = await import('../../../packages/core/src/shared/routes/History.jsx');
const { pendingTxToEntry } = await import('../../../packages/core/src/shared/utils/pendingHistory.js');

afterEach(() => cleanup());

const TXID = 'ab'.repeat(32);

describe('pending row for a raw broadcast', () => {
    it('shows the txid and a plain label instead of "unknown"', () => {
        const entry = pendingTxToEntry({
            chainId: 'bitcoin-mainnet',
            address: 'bc1qwallet',
            pendingTx: {
                id: 'raw-1', txid: TXID, status: 'broadcasting', fromAddress: 'unknown',
                toAddress: 'unknown', action: 'BROADCAST_SIGNED_TX',
            },
            ownAddresses: new Set(['bc1qwallet']),
            observedAtMs: Date.now(),
        });
        const { container } = render(
            <EntryRow
                entry={entry}
                selected={false}
                showConnector={false}
                onClick={vi.fn()}
                peerCache={{}}
                walletId="wallet-a"
            />,
        );
        const text = container.textContent;
        expect(text).not.toMatch(/unknown/i);
        expect(text).toMatch(/Raw transaction/);
        expect(container.querySelector(`[title="${TXID}"]`)).not.toBeNull();
    });
});
