// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The unlocked shell tells the person what became of a send that settled while
// another window had locked the wallet: one notice, a line per send, cleared
// once they move to another page.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

let outcomes = [];
const cleared = [];

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({
        messaging: {
            listLockedSendOutcomes: async () => outcomes,
            clearLockedSendOutcomes: async ({ ids }) => { cleared.push(...ids); return { cleared: ids.length }; },
        },
    }),
}));

const { LockedSendOutcomeNotice } = await import(
    '../../../packages/core/src/shared/components/LockedSendOutcomeNotice.jsx');

afterEach(() => {
    cleanup();
    outcomes = [];
    cleared.length = 0;
});

const TXID = 'ab'.repeat(32);

describe('LockedSendOutcomeNotice', () => {
    it('says a send went out while the wallet was locked, with its transaction', async () => {
        outcomes = [{ id: 'p1', kind: 'sent', txid: TXID, amount: '0.0003', tick: 'BTC', summary: 'Send 0.0003 BTC to bcrt1qdest' }];
        render(<LockedSendOutcomeNotice walletId="w1" routeKey="home" />);
        const notice = await screen.findByTestId('locked-send-outcome');
        expect(notice.getAttribute('role')).toBe('status');
        expect(notice.textContent).toContain('Sent while the wallet was locked.');
        expect(notice.textContent).toContain('Send 0.0003 BTC to bcrt1qdest');
        expect(notice.textContent).toContain(`${TXID.slice(0, 8)}…${TXID.slice(-8)}`);
    });

    it('names a send that did not go out, in one notice with the sent one', async () => {
        outcomes = [
            { id: 'p1', kind: 'sent', txid: TXID, amount: '1', tick: 'BTC', summary: null },
            { id: 'p2', kind: 'unsent', txid: null, amount: '2', tick: 'BTC', summary: null },
        ];
        render(<LockedSendOutcomeNotice walletId="w1" routeKey="home" />);
        const notice = await screen.findByTestId('locked-send-outcome');
        expect(screen.getAllByTestId('locked-send-outcome')).toHaveLength(1);
        expect(notice.getAttribute('data-variant')).toBe('warning');
        expect(notice.textContent).toContain('A send of 1 BTC');
        expect(notice.textContent).toContain('A send of 2 BTC. The wallet locked before it was sent. Nothing left the wallet.');
    });

    it('forgets the outcomes when the person moves to another page', async () => {
        outcomes = [{ id: 'p1', kind: 'sent', txid: TXID, amount: '1', tick: 'BTC', summary: null }];
        const { rerender } = render(<LockedSendOutcomeNotice walletId="w1" routeKey="home" />);
        await screen.findByTestId('locked-send-outcome');
        expect(cleared).toEqual([]);
        rerender(<LockedSendOutcomeNotice walletId="w1" routeKey="history" />);
        await waitFor(() => expect(screen.queryByTestId('locked-send-outcome')).toBeNull());
        expect(cleared).toEqual(['p1']);
    });

    it('never shows one wallet\'s outcome under the next wallet', async () => {
        const byWallet = { w1: [{ id: 'p1', kind: 'sent', txid: TXID, amount: '1', tick: 'BTC', summary: null }], w2: [] };
        outcomes = byWallet.w1;
        const { rerender } = render(<LockedSendOutcomeNotice walletId="w1" routeKey="home" />);
        await screen.findByTestId('locked-send-outcome');
        outcomes = byWallet.w2;
        rerender(<LockedSendOutcomeNotice walletId="w2" routeKey="home" />);
        await waitFor(() => expect(screen.queryByTestId('locked-send-outcome')).toBeNull());
    });

    it('renders nothing when no send settled while locked', async () => {
        const { container } = render(<LockedSendOutcomeNotice walletId="w1" routeKey="home" />);
        await new Promise((r) => setTimeout(r, 0));
        expect(container.textContent).toBe('');
    });
});
