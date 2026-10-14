// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { afterAll, afterEach, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({ walletMode: 'full', developerMode: false }),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    }),
    getAddressBalances: async () => { throw new Error('Preview unavailable'); },
    getTokenInfo: async () => null,
    parsePsbt: async () => ({
        decomposed: {
            inputs: [{ address: 'bcrt1qownaddressownaddress', value: 150000 }],
            outputs: [{ address: 'bcrt1qrecipientrecipient', value: 149500 }],
        },
        action: null,
        actionDecodeReason: 'NO_OP_RETURN',
    }),
    resolveApproval: async () => ({ approved: true }),
    requoteNativeFee: async () => null,
    preflight: async () => ({ verdict: 'pass', findings: [], unverified: [] }),
    describeAction: async ({ action }) => ({
        summary: action === 'EXECUTE'
            ? 'Call the escrow contract.'
            : 'Send 25 TEST to the recipient.',
        details: [{ label: 'Network', value: 'Bitcoin regtest' }],
        warnings: [],
    }),
    parseCoSign: async () => null,
}));

vi.stubGlobal('React', React);

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);
const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);

const chain = BUNDLED_DESCRIPTORS.find((descriptor) => descriptor.id === 'bitcoin-regtest');
const common = {
    origin: 'https://app.example',
    appName: 'Example app',
    chainId: 'bitcoin-regtest',
};

afterAll(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

async function scanSignApproval(kind, payload, readyText) {
    const view = render(
        <SignApproval
            id={`axe-${kind}`}
            kind={kind}
            payload={{ ...common, ...payload }}
            onReject={() => {}}
        />,
    );
    await screen.findByText(readyText);
    await expectNoSeriousAxeViolations(view.container);
}

describe('extension approval accessibility', () => {
    it('has no serious axe violations for a connect request', async () => {
        const view = render(
            <ConnectApproval
                id="axe-connect"
                payload={{
                    ...common,
                    requestedChains: [chain.id],
                    accountOptions: [{ id: 'account-1', name: 'Primary account' }],
                }}
                onReject={() => {}}
            />,
        );
        await screen.findByRole('button', { name: 'Connect' });
        await expectNoSeriousAxeViolations(view.container);
    });

    it('has no serious axe violations for a sign message request', async () => {
        await scanSignApproval(
            'signMessage',
            { payload: { message: 'Approve this login challenge.', address: 'bcrt1qsigner' } },
            'Approve this login challenge.',
        );
    });

    it('has no serious axe violations for a sign transaction request', async () => {
        await scanSignApproval(
            'signAction',
            {
                action: 'SEND',
                payload: { TICK: 'TEST', QUANTITY: '25', DESTINATION: 'bcrt1qrecipient' },
            },
            'Send 25 TEST to the recipient.',
        );
    });

    it('has no serious axe violations for a sign PSBT request', async () => {
        await scanSignApproval(
            'signPsbt',
            { payload: { psbtHex: '70736274ff' } },
            'Ordinary payment: this transaction carries no XChain action.',
        );
    });

    it('has no serious axe violations for a contract call request', async () => {
        await scanSignApproval(
            'signAction',
            {
                action: 'EXECUTE',
                payload: { CONTRACT: 'escrow.test', METHOD: 'release' },
            },
            'Call the escrow contract.',
        );
    });
});
