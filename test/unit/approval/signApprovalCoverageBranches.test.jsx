// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    listWallets: vi.fn(),
    resolveApproval: vi.fn(),
    getAddressBalances: vi.fn(),
    getAddressesByChain: vi.fn(),
    getSettings: vi.fn(),
    parsePsbt: vi.fn(),
    requoteNativeFee: vi.fn(),
    parseCoSign: vi.fn(),
    preflight: vi.fn(),
    describeAction: vi.fn(),
    getTokenInfo: vi.fn(),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => mocks);
vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);

function mount(kind, payload) {
    return render(
        <SignApproval id={`coverage-${kind}`} kind={kind} payload={payload} onReject={() => {}} />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWallets.mockResolvedValue([{ id: 'wallet-1', name: 'Wallet 1' }]);
    mocks.resolveApproval.mockResolvedValue({ resolved: true });
    mocks.getAddressBalances.mockRejectedValue(new Error('preview unavailable'));
    mocks.getAddressesByChain.mockResolvedValue({
        'bitcoin-regtest': [{ address: 'bcrt1qowner', derivationPath: "m/84'/1'/0'/0/0" }],
    });
    mocks.getSettings.mockResolvedValue(null);
    mocks.parsePsbt.mockResolvedValue({ decomposed: { inputs: [], outputs: [] } });
    mocks.requoteNativeFee.mockResolvedValue({});
    mocks.parseCoSign.mockResolvedValue(null);
    mocks.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
    mocks.describeAction.mockResolvedValue({ summary: 'Action', details: [], warnings: [] });
    mocks.getTokenInfo.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

describe('SignApproval remaining approval shapes', () => {
    it('matches a PSBT signer by derivation path and forwards native fee mode', async () => {
        mocks.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ value: 1000 }],
                outputs: [{ address: 'bcrt1qfee', value: 100 }],
            },
            action: { action: 'MINT', actionString: 'MINT|1|JDOG|1' },
            actionDecodeReason: null,
        });
        mocks.requoteNativeFee.mockResolvedValue({ feeDestination: 'bcrt1qfee' });
        mount('signPsbt', {
            chainId: 'bitcoin-regtest',
            payload: {
                psbtHex: '70736274ff',
                signingPaths: [{ derivationPath: "m/84'/1'/0'/0/0" }],
            },
        });

        await waitFor(() => expect(mocks.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            feeMode: 'native',
            mode: 'report',
        }));
        expect(screen.queryByText('The requested signing account is not available in this wallet.'))
            .toBeNull();
    });

    it('renders destinations and confirmation for an in-policy co-sign preview', async () => {
        mocks.parseCoSign.mockResolvedValue({
            account: {},
            decodeOk: true,
            decodeReason: null,
            action: 'SEND',
            destinations: ['bcrt1qrecipient'],
            policyOk: true,
            policyReason: null,
            needsConfirmation: true,
        });
        mocks.describeAction.mockResolvedValue({
            summary: 'Send funds',
            details: [{ label: 'To', value: 'bcrt1qrecipient' }],
            warnings: ['Review destination'],
        });
        mount('coSign', {
            chainId: 'bitcoin-regtest',
            payload: { accountId: 'account-1', psbtHex: 'deadbeef' },
        });

        expect(await screen.findByText('bcrt1qrecipient')).toBeTruthy();
        expect(screen.getByText(/confirm-threshold/i)).toBeTruthy();
        expect(mocks.describeAction).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            action: 'SEND',
            params: {},
        });
    });

    it('reuses a resolved ticker name from the module cache', async () => {
        mocks.getTokenInfo.mockResolvedValue({ canonicalTick: 'CACHED' });
        const payload = {
            chainId: 'bitcoin-regtest',
            action: 'SEND',
            payload: { TICK: '^987654321', QUANTITY: '1', DESTINATION: 'bcrt1qrecipient' },
        };
        const first = mount('signAction', payload);
        await waitFor(() => expect(mocks.getTokenInfo).toHaveBeenCalledOnce());
        first.unmount();

        mount('signAction', payload);
        await waitFor(() => expect(mocks.describeAction).toHaveBeenCalled());

        expect(mocks.getTokenInfo).toHaveBeenCalledOnce();
    });
});
