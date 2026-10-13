// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: vi.fn(async () => [{ id: 'wallet-1', name: 'Wallet 1' }]),
    getSettings: vi.fn(async () => ({ walletMode: 'watcher' })),
    getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [] })),
    parsePsbt: vi.fn(async () => ({
        decomposed: { inputs: [], outputs: [] },
        action: null,
        actionDecodeReason: 'NO_OP_RETURN',
    })),
    resolveApproval: vi.fn(),
    getAddressBalances: vi.fn(async () => ({})),
    getTokenInfo: vi.fn(async () => null),
    requoteNativeFee: vi.fn(async () => null),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async () => ({ summary: 'Action', details: [], warnings: [] })),
    parseCoSign: vi.fn(async () => ({
        account: { id: 'account-1', name: 'Account', chainId: 'bitcoin-regtest' },
        decodeOk: true,
        policyOk: true,
        action: null,
        destinations: [],
    })),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

afterAll(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

const CASES = [
    ['signMessage', { chainId: 'bitcoin-regtest', payload: { message: 'hello' } }],
    ['signPsbt', { chainId: 'bitcoin-regtest', payload: { psbtHex: '70736274ff' } }],
    ['signAction', { chainId: 'bitcoin-regtest', action: 'MINT', payload: {} }],
    ['coSign', { chainId: 'bitcoin-regtest', payload: { accountId: 'account-1', psbtHex: '70736274ff' } }],
    ['signIn', {
        chainId: 'bitcoin-regtest',
        payload: { addresses: [{ chainId: 'bitcoin-regtest', address: 'bcrt1qwatcher' }] },
    }],
];

describe('SignApproval in watcher mode', () => {
    it.each(CASES)('%s never asks for a password or resolves an approval', async (kind, payload) => {
        render(
            <SignApproval
                id={`watcher-${kind}`}
                kind={kind}
                payload={{ origin: 'https://app.example', ...payload }}
                onReject={() => {}}
            />,
        );

        await screen.findByText(/Watcher mode never signs or asks for a password/i);
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: /^(Approve|Sign in)$/i })).toBeNull();
        expect(messaging.resolveApproval).not.toHaveBeenCalled();
    });
});
