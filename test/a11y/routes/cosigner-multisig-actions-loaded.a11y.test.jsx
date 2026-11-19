// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The agent account page and one multisig signing session, loaded, with
// their actions drawn as the shared action list (G101) and the session's
// Actions | Details toggle (G102). The route sweeps (routes-a-l, m-z-routes)
// only see these pages' loading states.

import React from 'react';
import { afterEach, describe, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import { MultisigSigningSession } from '../../../packages/core/src/shared/routes/MultisigSigningSession.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const PK_A = `02${'11'.repeat(32)}`;
const PK_B = `02${'22'.repeat(32)}`;
const PK_C = `02${'33'.repeat(32)}`;
const NOW = '2026-10-13T12:00:00.000Z';

const AGENT = Object.freeze({
    id: 'acct-1',
    walletId: 'wallet-1',
    chainId: 'bitcoin-testnet',
    name: 'Trading bot',
    enabled: true,
    aggregateAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    agentPubkey: PK_A,
    daemonPubkey: PK_B,
    policy: { allowedActions: ['SEND'], allowedTicks: null },
    allowedOutputs: [],
    window: { version: 1, entries: [] },
});

const SESSION = Object.freeze({
    schemaVersion: 1,
    id: 'session-1',
    walletId: 'wallet-1',
    chainId: 'bitcoin-testnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [PK_A, PK_B, PK_C],
    msgHash: 'aa'.repeat(32),
    psbtHex: '70736274ff',
    actionSummary: 'Send 0.01 BTC',
    nonces: [],
    aggNonce: null,
    partialSigs: [],
    aggregatedSchnorrSig: null,
    signatures: [{ pubkey: PK_A, sig: '30'.repeat(35), contributedAt: NOW }],
    status: 'collecting-sigs',
    finalizedTxHex: null,
    txid: null,
    createdAt: NOW,
    updatedAt: NOW,
});

function messaging() {
    const target = {
        getCoSignerAccount: async () => AGENT,
        getCoSignerAccountBalances: async () => ({}),
        listCoSignRequests: async () => [],
        listMultisigSigningSessions: async () => [SESSION],
        getMultisigSigningSession: async () => SESSION,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return async () => ({});
        },
    });
}

async function mount(element) {
    let utils;
    await act(async () => {
        utils = render(<MessagingProvider shell="web" messaging={messaging()}>{element}</MessagingProvider>);
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => cleanup());

describe('Agent account and multisig session actions have no serious axe violations', () => {
    it('the agent account page on its Actions tab', async () => {
        const { container, getByRole } = await mount(
            <CoSignerAccountDetail accountId="acct-1" walletId="wallet-1" onBack={() => {}} />,
        );
        getByRole('list', { name: 'Actions' });
        await expectNoSeriousAxeViolations(container);
    });

    it('a signing session on Actions, then on Details', async () => {
        const { container, getByRole } = await mount(
            <MultisigSigningSession walletId="wallet-1" onBack={() => {}} initialSessionId="session-1" />,
        );
        getByRole('list', { name: 'Actions' });
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(getByRole('tab', { name: 'Details' }));
        getByRole('list', { name: 'Pending cosigners' });
        await expectNoSeriousAxeViolations(container);
    });
});
