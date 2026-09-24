// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

// Unit: SignApproval's signPsbt intent decode (§21.2 / §48). The output
// set is decoded independently of the raw hex the dApp supplied (via the
// same psbt.parse host route the in-wallet sign form uses) so the user
// sees recipients, change and any carried XChain action before entering
// a password. Mounted for real; the mock stands in for the extension's
// message-passing bridge only.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({}),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    }),
    parsePsbt: vi.fn(async () => ({
        decomposed: {
            inputs: [{ address: 'bcrt1qownaddressownaddress', value: 150000 }],
            outputs: [
                { address: 'bcrt1qrecipientrecipient', value: 100000 },
                { address: 'bcrt1qownaddressownaddress', value: 49500 },
            ],
        },
        action: { action: 'MINT', version: 1 },
        actionDecodeReason: null,
    })),
    resolveApproval: async () => ({ approved: true }),
    getAddressBalances: async () => { throw new Error('not used by signPsbt'); },
    getTokenInfo: async () => { throw new Error('not used by signPsbt'); },
    preflight: async () => { throw new Error('not used by signPsbt'); },
    describeAction: async () => { throw new Error('not used by signPsbt'); },
    parseCoSign: async () => { throw new Error('not used by signPsbt'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
    cleanup();
    messaging.parsePsbt.mockClear();
});

describe('SignApproval signPsbt intent', () => {
    it('renders the intent decoded from the requested PSBT', async () => {
        render(
            <SignApproval
                id="request-1"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        const panel = await screen.findByTestId('psbt-intent-panel');
        expect(screen.getByTestId('psbt-action-intent').textContent)
            .toBe('Carries an XChain MINT action (v1)');
        expect(panel.textContent).toContain('Recipient');
        expect(panel.textContent).toContain('100,000 sats');
        expect(panel.textContent).toContain('Change (back to you)');
        expect(panel.textContent).toContain('49,500 sats');
        expect(panel.textContent).toContain('Your address');
        expect(messaging.parsePsbt).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            psbtHex: 'deadbeefcafe',
        });
    });
});
