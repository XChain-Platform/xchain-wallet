// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

// Unit: the co-sign approval warning slot speaks plain words. Decoder codes,
// policy codes and developer exception text stay off the confirmation.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({}),
    getAddressesByChain: async () => ({}),
    parsePsbt: async () => { throw new Error('not used by coSign'); },
    resolveApproval: vi.fn(async () => ({ approved: false })),
    getAddressBalances: async () => { throw new Error('not used by coSign'); },
    getTokenInfo: async () => { throw new Error('not used by coSign'); },
    requoteNativeFee: async () => { throw new Error('not used by coSign'); },
    preflight: async () => { throw new Error('not used by coSign'); },
    describeAction: async () => { throw new Error('not used here'); },
    parseCoSign: vi.fn(),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

const ACCOUNT = { id: 'acct-1', name: 'Agent one', chainId: 'bitcoin-regtest', aggregateAddress: 'bcrt1qagent' };
const RAW_CODE = /[A-Z]{2,}_[A-Z_]+/;

function renderCoSign() {
    render(
        <SignApproval
            id="cosign-1"
            kind="coSign"
            payload={{
                chainId: 'bitcoin-regtest',
                payload: { accountId: 'acct-1', psbtHex: 'deadbeefcafe' },
            }}
            onReject={() => {}}
        />,
    );
}

function alertText() {
    return screen.queryByTestId('confirm-warning')?.textContent || '';
}

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
    cleanup();
    messaging.parseCoSign.mockReset();
});

describe('SignApproval co-sign alerts', () => {
    it('names an undecodable action in plain words without a technical disclosure', async () => {
        messaging.parseCoSign.mockResolvedValue({
            account: { ...ACCOUNT, name: '' },
            decodeOk: false,
            decodeReason: 'ENVELOPE_SCRIPT_INVALID',
            action: null,
            destinations: [],
            policyOk: false,
            policyReason: 'UNDECODABLE',
            needsConfirmation: false,
        });
        renderCoSign();

        await screen.findByTestId('confirm-warning');
        expect(screen.getByText('Cosigner account')).toBeTruthy();
        expect(alertText()).toContain('The action in this co-sign request could not be read because the action data is malformed.');
        expect(alertText()).not.toMatch(RAW_CODE);
        expect(document.querySelector('details')).toBeNull();
        expect(document.body.textContent).not.toContain('ENVELOPE_SCRIPT_INVALID');
    });

    it('names a policy violation in plain words without the policy code', async () => {
        messaging.parseCoSign.mockResolvedValue({
            account: ACCOUNT,
            decodeOk: true,
            decodeReason: null,
            action: 'SEND',
            params: {},
            amount: '5',
            tick: 'JDOG',
            destinations: [],
            policyOk: false,
            policyReason: 'POLICY_WINDOW_AMOUNT_EXCEEDED',
            needsConfirmation: false,
        });
        renderCoSign();

        await screen.findByTestId('confirm-warning');
        expect(alertText()).toContain(
            "This request is outside the account policy because it would go over this account's spending limit for the current period.",
        );
        expect(alertText()).toContain('The cosigner will refuse it even if you approve.');
        expect(alertText()).not.toMatch(RAW_CODE);
        expect(document.body.textContent).not.toContain('POLICY_WINDOW_AMOUNT_EXCEEDED');
    });

    it('falls back to a sentence with no reason for an unmapped policy code', async () => {
        messaging.parseCoSign.mockResolvedValue({
            account: ACCOUNT,
            decodeOk: true,
            decodeReason: null,
            action: 'SEND',
            params: {},
            destinations: [],
            policyOk: false,
            policyReason: 'POLICY_DENIED',
            needsConfirmation: false,
        });
        renderCoSign();

        await screen.findByTestId('confirm-warning');
        expect(alertText()).toContain('This request is outside the account policy. The cosigner will refuse it even if you approve.');
        expect(alertText()).not.toMatch(RAW_CODE);
    });

    it('keeps a developer exception off the confirmation', async () => {
        messaging.parseCoSign.mockRejectedValue(
            new Error('previewCoSignRequest: SDK with sdk.coSigner decode + policy is required'),
        );
        renderCoSign();

        await screen.findByTestId('confirm-warning');
        expect(alertText()).toContain('This co-sign request could not be read. Only approve it if you trust the source.');
        expect(alertText()).not.toContain('previewCoSignRequest');
        expect(document.querySelector('details')).toBeNull();
    });

    it('passes copy written for a user through without a details disclosure', async () => {
        messaging.parseCoSign.mockRejectedValue(new Error('This cosigner account is turned off.'));
        renderCoSign();

        await screen.findByText(/This cosigner account is turned off\./);
        expect(alertText()).toContain('This co-sign request could not be read. This cosigner account is turned off.');
        expect(screen.queryByTestId('cosign-error-details')).toBeNull();
    });
});
