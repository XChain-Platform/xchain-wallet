// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

// Unit: a site that already holds Always allow for actions still gets the
// review and the password prompt on every signAction, but the screen must not
// offer to save a grant that is already stored. The bridge marks such a
// request `alreadyGranted` (handlers.js); this pins that the screen reads it
// for signAction the same way it already did for signMessage.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({}),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    }),
    getAddressBalances: async () => { throw new Error('no balances in this test'); },
    getTokenInfo: vi.fn(async () => null),
    parsePsbt: async () => { throw new Error('not used by signAction'); },
    resolveApproval: vi.fn(async () => ({ approved: true })),
    requoteNativeFee: vi.fn(async () => ({ feeDestination: 'bcrt1qfeedestination' })),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async () => null),
    parseCoSign: async () => { throw new Error('not used by signAction'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

function renderSignAction(extra = {}) {
    render(
        <SignApproval
            id="request-granted"
            kind="signAction"
            payload={{
                chainId: 'bitcoin-regtest',
                action: 'SEND',
                payload: { TICK: 'XCHAIN', QUANTITY: '1', DESTINATION: 'bcrt1qrecipientrecipient', ...extra },
            }}
            onReject={() => {}}
        />,
    );
}

describe('SignApproval Always allow box on a signAction', () => {
    it('offers Always allow to a site that holds no stored grant', async () => {
        renderSignAction();
        expect(await screen.findByRole('checkbox', { name: /Always allow this site/i })).toBeInTheDocument();
    });

    it('hides Always allow once the grant is stored, and still asks for the password', async () => {
        renderSignAction({ alreadyGranted: true });
        await screen.findByRole('button', { name: 'Approve' });
        expect(screen.getByLabelText('Password', { selector: 'input' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /Always allow this site/i })).toBeNull();
    });
});
