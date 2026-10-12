// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

// Unit: SignApproval resolves a `^<id>` ticker reference in a signAction to its
// readable name through the approval module's getTokenInfo, called with the
// same request object the popup, web and desktop helpers take. The screen
// swallows a failed lookup and keeps the raw reference, so a call in the wrong
// shape would fail silently; this pins the shape and that the resolved name is
// what the screen asks the host to describe.

import React from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({}),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    }),
    getAddressBalances: async () => { throw new Error('no balances in this test'); },
    getTokenInfo: vi.fn(async () => ({ canonicalTick: 'READABLE' })),
    parsePsbt: async () => { throw new Error('not used by signAction'); },
    resolveApproval: vi.fn(async () => ({ approved: true })),
    requoteNativeFee: vi.fn(async () => ({ feeDestination: 'bcrt1qfeedestination' })),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async () => null),
    parseCoSign: async () => { throw new Error('not used by signAction'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

afterAll(() => vi.unstubAllGlobals());

describe('SignApproval ticker reference names', () => {
    it('asks the host for a ^id ticker with the popup request shape and describes the resolved name', async () => {
        render(
            <SignApproval
                id="request-tick"
                kind="signAction"
                payload={{
                    chainId: 'bitcoin-regtest',
                    action: 'SEND',
                    payload: { TICK: '^1234', QUANTITY: '1', DESTINATION: 'bcrt1qrecipientrecipient' },
                }}
                onReject={() => {}}
            />,
        );

        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalled());
        expect(messaging.getTokenInfo).toHaveBeenCalledWith({ chainId: 'bitcoin-regtest', tick: '^1234' });
        expect(messaging.getTokenInfo.mock.calls[0]).toHaveLength(1);
        await waitFor(() => expect(messaging.describeAction).toHaveBeenCalledWith(
            expect.objectContaining({ params: expect.objectContaining({ TICK: 'READABLE' }) }),
        ));
    });
});
