// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Agent accounts: the Allowed tokens section of the policy editor, network
// and balances on the list rows (one read for every row), and the account
// page with waiting requests on top, the identity card, and Actions,
// Activity and Details tabs.

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList, balanceSummary } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import {
    CoSignerPolicyEditor,
    buildPolicyDraft,
    draftFromAccount,
    emptyPolicyDraft,
} from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';

afterEach(() => cleanup());

function account(overrides = {}) {
    return {
        id: 'acct-1',
        walletId: 'wallet-1',
        name: 'Trading bot',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1pagent',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '03' + 'b'.repeat(64),
        recoveryPublicKey: null,
        enabled: true,
        policy: { allowedActions: ['ORDER', 'SWAP'], allowedTicks: ['MYTOKEN', 'XCHAIN'] },
        allowedOutputs: [],
        window: { entries: [] },
        ...overrides,
    };
}

function balancesFor(ids) {
    return Object.fromEntries(ids.map((id) => [id, {
        error: null,
        balances: {
            native: { tick: 'BTC', quantity: '48210000', divisibility: 8 },
            tokens: [
                { tick: 'MYTOKEN', quantity: '12000', divisibility: 0 },
                { tick: 'PEPECASH', quantity: '800', divisibility: 0 },
            ],
        },
    }]));
}

describe('Allowed tokens in the policy editor', () => {
    it('stores Any as no key, None as an empty list, and a list folded to upper case', () => {
        const base = { ...emptyPolicyDraft(), allowedActionsText: 'SEND' };
        expect('allowedTicks' in buildPolicyDraft(base).policy).toBe(false);
        expect(buildPolicyDraft({ ...base, tokenMode: 'none' }).policy.allowedTicks).toEqual([]);
        expect(buildPolicyDraft({ ...base, tokenMode: 'list', allowedTicksText: 'mytoken, XCHAIN mytoken' }).policy.allowedTicks)
            .toEqual(['MYTOKEN', 'XCHAIN']);
    });

    it('refuses an empty list and a ticker that is an id reference', () => {
        const base = { ...emptyPolicyDraft(), allowedActionsText: 'SEND', tokenMode: 'list' };
        expect(buildPolicyDraft({ ...base, allowedTicksText: ' , ' }).error).toBe('List at least one allowed token, or choose Any token or None.');
        expect(buildPolicyDraft({ ...base, allowedTicksText: 'MYTOKEN, ^42' }).error).toBe("^42 isn't a token ticker. Use letters, digits and . - _ only.");
    });

    it('round-trips each mode through a stored account', () => {
        expect(draftFromAccount(account())).toMatchObject({ tokenMode: 'list', allowedTicksText: 'MYTOKEN, XCHAIN' });
        expect(draftFromAccount(account({ policy: { allowedActions: ['SEND'], allowedTicks: [] } }))).toMatchObject({ tokenMode: 'none' });
        expect(draftFromAccount(account({ policy: { allowedActions: ['SEND'] } }))).toMatchObject({ tokenMode: 'any', allowedTicksText: '' });
    });

    it('draws Allowed tokens right after Allowed actions, and shows the list field only for a list', () => {
        function Harness() {
            const [draft, setDraft] = useState({ ...emptyPolicyDraft(), allowedActionsText: 'SEND' });
            return <CoSignerPolicyEditor value={draft} onChange={setDraft} />;
        }
        render(<Harness />);
        const sections = screen.getAllByRole('region').map((s) => s.getAttribute('aria-label'));
        expect(sections.slice(0, 2)).toEqual(['Allowed actions', 'Allowed tokens']);
        const group = screen.getByRole('group', { name: 'Tokens the agent may move' });
        expect(within(group).getByRole('radio', { name: /Any token/ })).toBeChecked();
        expect(screen.queryByRole('textbox', { name: /^Tokens/ })).toBeNull();
        fireEvent.click(within(group).getByRole('radio', { name: /Only These Tokens/ }));
        const field = screen.getByRole('textbox', { name: /^Tokens/ });
        fireEvent.change(field, { target: { value: 'mytoken' } });
        expect(field).toHaveValue('MYTOKEN');
    });
});

describe('Agent account list rows', () => {
    async function mountList(rows) {
        const list = rows.map((i) => account({ id: `acct-${i}`, name: `Agent ${i}`, aggregateAddress: `bcrt1pagent${i}` }));
        const getCoSignerAccountBalances = vi.fn().mockResolvedValue(balancesFor(list.map((a) => a.id)));
        const getAddressBalances = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={{
                listCoSignerAccounts: vi.fn().mockResolvedValue(list),
                getCoSignerAccountBalances,
                getAddressBalances,
            }}>
                <CoSignerAccountList walletId="wallet-1" onBack={() => {}} onOpen={() => {}} onProvision={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getAllByText('0.4821 BTC · 2 tokens')).toHaveLength(rows.length));
        const reads = getCoSignerAccountBalances.mock.calls.length + getAddressBalances.mock.calls.length;
        cleanup();
        return reads;
    }

    it('reads balances once for 2 rows and once for 8 rows', async () => {
        const small = await mountList([1, 2]);
        const large = await mountList([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(small).toBe(1);
        expect(large).toBe(small);
    });

    it('names the network and the allowed tokens on each row', async () => {
        render(
            <MessagingProvider shell="web" messaging={{
                listCoSignerAccounts: vi.fn().mockResolvedValue([account()]),
                getCoSignerAccountBalances: vi.fn().mockResolvedValue(balancesFor(['acct-1'])),
            }}>
                <CoSignerAccountList walletId="wallet-1" onBack={() => {}} onOpen={() => {}} onProvision={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findByText('Network: Bitcoin Regtest')).toBeInTheDocument();
        expect(screen.getByText('2-of-2 · Order, Swap · MYTOKEN, XCHAIN')).toBeInTheDocument();
    });

    it('says the balance is unavailable when the read failed or the shell has no route', () => {
        expect(balanceSummary({}, 'acct-1')).toBe('Balance unavailable');
        expect(balanceSummary({ 'acct-1': { balances: null, error: 'x' } }, 'acct-1')).toBe('Balance unavailable');
        expect(balanceSummary(null, 'acct-1')).toBe('Loading balance…');
    });
});

describe('Agent account page', () => {
    function mountDetail({ acct = account(), pending = [], extra = {} } = {}) {
        const messaging = {
            getCoSignerAccount: vi.fn().mockResolvedValue(acct),
            getCoSignerAccountBalances: vi.fn().mockResolvedValue(balancesFor([acct.id])),
            listCoSignRequests: vi.fn().mockResolvedValue(pending),
            refuseCoSignRequest: vi.fn().mockResolvedValue({ resolved: true }),
            focusCoSignRequest: vi.fn().mockResolvedValue({ focused: true }),
            ...extra,
        };
        render(
            <MessagingProvider shell="extension" messaging={messaging}>
                <CoSignerAccountDetail accountId={acct.id} walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );
        return messaging;
    }

    it('puts a waiting request above the identity card with Refuse and Approve', async () => {
        const messaging = mountDetail({
            pending: [{ id: 'req-1', action: 'ORDER', amount: '0.04', tick: 'BTC', policyOk: true, policyReason: null }],
        });
        const title = await screen.findByText('Wants to Order 0.04 BTC');
        const card = screen.getByRole('region', { name: 'Agent account' });
        expect(title.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Waiting on your approval')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(messaging.focusCoSignRequest).toHaveBeenCalledWith({ id: 'req-1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Refuse' }));
        await waitFor(() => expect(messaging.refuseCoSignRequest).toHaveBeenCalledWith({ id: 'req-1' }));
        expect(messaging.listCoSignRequests).toHaveBeenCalledWith({ accountId: 'acct-1' });
    });

    it('says why an out-of-rules request waits and keeps Approve off', async () => {
        mountDetail({
            pending: [{ id: 'req-2', action: 'SWAP', amount: '500', tick: 'PEPECASH', policyOk: false, policyReason: 'POLICY_TOKEN_NOT_ALLOWED' }],
        });
        expect(await screen.findByText("Outside the rules: the token is not on this account's list of allowed tokens")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    });

    it('starts at the identity card when nothing waits, with name, status, network, tokens and balance', async () => {
        mountDetail();
        const card = await screen.findByRole('region', { name: 'Agent account' });
        expect(within(card).getByRole('heading', { name: 'Trading bot' })).toBeInTheDocument();
        expect(within(card).getByText('Active')).toBeInTheDocument();
        expect(within(card).getByText('Network: Bitcoin Regtest')).toBeInTheDocument();
        expect(within(card).getByText('MYTOKEN, XCHAIN')).toBeInTheDocument();
        await waitFor(() => expect(within(card).getByText('0.4821 BTC · 2 tokens')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    });

    it('has Actions, Activity and Details tabs, each with an icon, and Actions as tiles', async () => {
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Activity', 'Details']);
        for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
        const tiles = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button');
        expect(tiles.map((tile) => tile.textContent)).toEqual(['Fund', 'Withdraw', 'Edit Rules', 'Copy Address', 'Turn Off']);
        for (const tile of tiles) expect(tile.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDisabled();
    });

    it('lists signed requests on Activity, newest first', async () => {
        const now = Date.now();
        mountDetail({ acct: account({ window: { version: 1, entries: [
            { t: now - 7_200_000, action: 'ORDER', tick: 'BTC', amount: '0.02' },
            { t: now - 60_000, action: 'SEND', tick: 'MYTOKEN', amount: '5' },
        ] } }) });
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
        const rows = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole('listitem');
        expect(rows.map((row) => row.textContent)).toEqual([
            expect.stringMatching(/^Send MYTOKENSigned · .+5$/),
            expect.stringMatching(/^Order BTCSigned · .+0\.02$/),
        ]);
    });

    it('shows holdings with which tokens the agent may move, and the rules and keys, on Details', async () => {
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const holdings = await screen.findByRole('list', { name: 'Holdings' });
        const rows = within(holdings).getAllByRole('listitem').map((row) => row.textContent);
        expect(rows).toEqual([
            'BTC0.4821',
            'MYTOKENAllowed12,000',
            "PEPECASHNot allowed: the agent can't move it800",
        ]);
        const details = screen.getByRole('region', { name: 'Details' });
        expect(within(details).getByText('Allowed tokens')).toBeInTheDocument();
        expect(within(details).getByText('Agent key')).toBeInTheDocument();
        expect(within(details).getByText('02' + 'a'.repeat(64))).toBeInTheDocument();
    });

    it('reads nothing for waiting requests in a shell without that route', async () => {
        mountDetail({ extra: { listCoSignRequests: undefined } });
        await screen.findByRole('region', { name: 'Agent account' });
        await act(async () => {});
        expect(screen.queryByRole('button', { name: 'Refuse' })).toBeNull();
    });
});
