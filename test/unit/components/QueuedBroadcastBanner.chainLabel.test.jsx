// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Queued-broadcast rows name the chain in words, never by its internal id.
// A user deciding whether to re-send a signed transaction reads this line,
// so "Litecoin regtest" must show where "litecoin-regtest" used to.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

let queue = [];

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({
        messaging: { listQueuedBroadcasts: async () => queue },
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal' }),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {} }),
}));

const { QueuedBroadcastBanner } = await import(
    '../../../packages/core/src/shared/components/QueuedBroadcastBanner.jsx');

afterEach(() => {
    cleanup();
    queue = [];
});

function entry(chainId) {
    return { id: `q-${chainId}`, chainId, summary: 'Send 1 XCP', signedAt: Date.now() };
}

describe('QueuedBroadcastBanner chain label', () => {
    it('shows the chain display name instead of the raw chain id', async () => {
        queue = [entry('litecoin-regtest')];
        const { container } = render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        await screen.findByText('Send 1 XCP');
        expect(container.textContent).toContain('Litecoin');
        expect(container.textContent).not.toContain('litecoin-regtest');
    });

    it('falls back to the raw id only for a chain the registry does not know', async () => {
        queue = [entry('nochain-mainnet')];
        const { container } = render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        await screen.findByText('Send 1 XCP');
        expect(container.textContent).toContain('nochain-mainnet');
    });
});
