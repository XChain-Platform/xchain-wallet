// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Agent accounts wear the same identity as wallets and accounts (ruling
// 2026-11-15): an initials tile by default in the list and on the account
// page, and an Edit look page (no modal) that renames the agent and sets its
// tile colour, shape and image through the shared TileLookFields. The name
// saves to the agent record, the look to the per-device tile store. The
// list row and the Details card no longer show the allowed actions or the
// rolling window rate (display only; the policy is unchanged).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import { readWalletTile } from '../../../packages/core/src/shared/utils/walletTile.js';

beforeEach(() => { try { localStorage.clear(); } catch { /* storage may be blocked */ } });
afterEach(() => cleanup());

function agent(overrides = {}) {
    return {
        id: 'agent-1',
        walletId: 'wallet-1',
        name: 'Trading bot',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1pagentidentity',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '03' + 'b'.repeat(64),
        recoveryPublicKey: null,
        enabled: true,
        policy: { allowedActions: ['SEND', 'TRANSFER'], maxPerWindow: { hours: 24, maxActions: 12 } },
        allowedOutputs: [],
        window: { entries: [] },
        ...overrides,
    };
}

function mountList(rows) {
    render(
        <MessagingProvider shell="web" messaging={{
            listCoSignerAccounts: vi.fn().mockResolvedValue(rows),
            getCoSignerAccountBalances: vi.fn().mockResolvedValue({}),
        }}>
            <CoSignerAccountList walletId="wallet-1" onBack={() => {}} onOpen={() => {}} onProvision={() => {}} />
        </MessagingProvider>,
    );
}

function mountDetail(record = agent(), extra = {}) {
    let stored = record;
    const messaging = {
        getCoSignerAccount: vi.fn(async () => stored),
        getCoSignerAccountBalances: vi.fn().mockResolvedValue({}),
        listCoSignRequests: vi.fn().mockResolvedValue([]),
        updateCoSignerAccount: vi.fn(async ({ patch }) => {
            stored = { ...stored, ...patch };
            return stored;
        }),
        ...extra,
    };
    render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <CoSignerAccountDetail accountId={record.id} walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function openEditLook() {
    await screen.findByRole('region', { name: 'Agent account' });
    fireEvent.click(screen.getByRole('button', { name: /^Edit look/ }));
    await screen.findByRole('heading', { name: 'Edit Look' });
}

describe('agent tiles', () => {
    it('shows the initials tile on every list row by default', async () => {
        mountList([agent(), agent({ id: 'agent-2', name: 'Payroll assistant' })]);
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        const tiles = list.querySelectorAll('[data-agent-tile]');
        expect([...tiles].map((tile) => tile.textContent)).toEqual(['TB', 'PA']);
        // The old generic people icon is gone from the row's leading slot.
        for (const tile of tiles) expect(tile.querySelector('svg')).toBeNull();
    });

    it('shows the same initials tile on the account page identity card', async () => {
        mountDetail();
        const card = await screen.findByRole('region', { name: 'Agent account' });
        const tile = card.querySelector('[data-agent-tile]');
        expect(tile).not.toBeNull();
        expect(tile.textContent).toBe('TB');
        expect(tile.querySelector('svg')).toBeNull();
    });
});

describe('Edit look page', () => {
    it('is a row in the one action list and opens as its own page, not a dialog', async () => {
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        const list = screen.getByRole('list', { name: 'Actions' });
        const row = within(list).getByRole('button', { name: /^Edit look/ });
        expect(row.querySelector('svg')).not.toBeNull();
        fireEvent.click(row);
        expect(await screen.findByRole('heading', { name: 'Edit Look' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('radio', { name: /^(Circle|Rounded)/ })).toBeNull();
        expect(screen.getByLabelText(/^Account name/)).toHaveValue('Trading bot');
    });

    it('renames the agent through the agent record and shows the new name and initials', async () => {
        const messaging = mountDetail();
        await openEditLook();
        fireEvent.change(screen.getByLabelText(/^Account name/), { target: { value: 'Market maker' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await screen.findByRole('heading', { name: 'Market maker' });
        expect(messaging.updateCoSignerAccount).toHaveBeenCalledTimes(1);
        expect(messaging.updateCoSignerAccount).toHaveBeenCalledWith({ id: 'agent-1', patch: { name: 'Market maker' } });
        const card = screen.getByRole('region', { name: 'Agent account' });
        expect(card.querySelector('[data-agent-tile]').textContent).toBe('MM');
    });

    it('refuses an empty name and writes nothing', async () => {
        const messaging = mountDetail();
        await openEditLook();
        fireEvent.change(screen.getByLabelText(/^Account name/), { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
        expect(messaging.updateCoSignerAccount).not.toHaveBeenCalled();
        expect(readWalletTile('agent-1')).toEqual({});
    });

    it('keeps the look in the tile store and the list shows it', async () => {
        const messaging = mountDetail();
        await openEditLook();
        fireEvent.click(await screen.findByRole('radio', { name: 'Colour #2E7D32' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await screen.findByRole('region', { name: 'Agent account' });
        // An unchanged name writes no record update; the look alone is stored.
        expect(messaging.updateCoSignerAccount).not.toHaveBeenCalled();
        expect(readWalletTile('agent-1')).toMatchObject({ colour: '#2E7D32', shape: 'circle' });
        cleanup();

        mountList([agent()]);
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        const avatar = list.querySelector('[data-agent-tile] > *');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe('#2E7D32');
    });

    it('Back leaves the name and the look as they were', async () => {
        const messaging = mountDetail();
        await openEditLook();
        fireEvent.change(screen.getByLabelText(/^Account name/), { target: { value: 'Never saved' } });
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        await screen.findByRole('heading', { name: 'Trading bot' });
        expect(messaging.updateCoSignerAccount).not.toHaveBeenCalled();
        expect(readWalletTile('agent-1')).toEqual({});
    });
});

describe('lines left off the agent display', () => {
    it('the list row carries no allowed-actions or rolling-rate text', async () => {
        mountList([agent()]);
        await screen.findByText('Trading bot');
        // The scheme line is off the row by ruling; the detail page keeps it.
        expect(screen.queryByText(/\d-of-\d/)).toBeNull();
        expect(screen.queryByText(/Transfer/)).toBeNull();
        expect(screen.queryByText(/12 per 24/)).toBeNull();
    });

    it('the Details card has no Allowed actions or Rolling limit row', async () => {
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        const details = await screen.findByRole('region', { name: 'Details' });
        const labels = [...details.querySelectorAll('dt')].map((dt) => dt.textContent);
        expect(labels).not.toContain('Allowed actions');
        expect(labels).not.toContain('Rolling limit');
        expect(details.textContent).not.toMatch(/Transfer|12 actions per 24h/);
    });

    it('Edit rules still shows the allowed actions and the rolling limit', async () => {
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('button', { name: /^Edit rules/ }));
        await waitFor(() => expect(document.body.textContent).toMatch(/Rolling limit/));
        expect(document.body.textContent).toMatch(/12 actions per 24 h/);
    });
});
