// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';

const ACCOUNTS = [
    {
        id: 'agent-1', walletId: 'wallet-1', name: 'Agent One', chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1pagentone000000000000000000000000000000', enabled: true,
    },
    {
        id: 'agent-2', walletId: 'wallet-1', name: 'Agent Two', chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1pagenttwo000000000000000000000000000000', enabled: false,
    },
];

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return {
                width: layoutWidth, height: 800, top: 0, left: 0,
                right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {},
            };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
    try { globalThis.localStorage?.clear(); } catch { /* storage can be unavailable */ }
});

function makeMessaging() {
    return {
        listCoSignerAccounts: vi.fn().mockResolvedValue(ACCOUNTS),
        getCoSignerAccountBalances: vi.fn().mockResolvedValue({}),
    };
}

function Shell({ route = 'cosigner-accounts', initialId = null, onOpen = vi.fn(), onPick = vi.fn() }) {
    const [selected, setSelected] = useState(initialId);
    return (
        <CoSignerAccountList
            walletId="wallet-1"
            onBack={() => {}}
            onProvision={() => {}}
            onOpen={onOpen}
            selectedAccountId={selected}
            onSelectAccount={(id) => { onPick(id); setSelected(id); }}
            renderAccount={(id) => <h2>{`Detail ${id}`}</h2>}
            renderAccountPage={route === 'cosigner-detail'
                ? (id, page) => (
                    <main ref={page.measureRef} data-list-detail="page">
                        <h1>{`Standalone ${id}`}</h1>
                    </main>
                )
                : undefined}
        />
    );
}

function renderShell(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell {...props} />
        </MessagingProvider>,
    );
}

describe('My Agents two-panel layout', () => {
    it('preselects the first agent and persists the shared divider under agents', async () => {
        layoutWidth = 1046;
        const onPick = vi.fn();
        renderShell(makeMessaging(), { onPick });

        const panel = await screen.findByRole('region', { name: 'Agent One' });
        expect(within(panel).getByRole('heading', { name: 'Detail agent-1' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'My Agents' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Agent One/ })).toHaveAttribute('aria-current', 'true');
        await waitFor(() => expect(onPick).toHaveBeenCalledWith('agent-1'));

        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the agents list' }), { key: 'ArrowRight' });
        const prefs = JSON.parse(globalThis.localStorage?.getItem('xc:displayPrefs'));
        expect(prefs.panelSplits.agents).toBeGreaterThan(0);
    });

    it('swaps the detail without narrow navigation or replacing the list', async () => {
        layoutWidth = 1686;
        const onOpen = vi.fn();
        renderShell(makeMessaging(), { onOpen });

        await screen.findByRole('region', { name: 'Agent One' });
        const list = screen.getByRole('list', { name: 'Agent accounts' });
        fireEvent.click(screen.getByRole('button', { name: /Agent Two/ }));

        const panel = await screen.findByRole('region', { name: 'Agent Two' });
        expect(within(panel).getByText('Detail agent-2')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Agent accounts' })).toBe(list);
        expect(screen.getByRole('button', { name: /Agent Two/ })).toHaveAttribute('aria-current', 'true');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it.each([
        ['phone landscape', 640],
        ['just below the breakpoint', LIST_DETAIL_MIN_WIDTH - 1],
    ])('keeps list then detail navigation at %s', async (_label, width) => {
        layoutWidth = width;
        const onOpen = vi.fn();
        renderShell(makeMessaging(), { onOpen });

        const row = await screen.findByRole('button', { name: /Agent Two/ });
        expect(screen.queryByRole('separator')).toBeNull();
        expect(row).not.toHaveAttribute('aria-current');
        fireEvent.click(row);
        expect(onOpen).toHaveBeenCalledWith('agent-2');
    });
});

describe('Agent detail route', () => {
    it('keeps a deep-linked agent selected in the wide split', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(), { route: 'cosigner-detail', initialId: 'agent-2' });

        const panel = await screen.findByRole('region', { name: 'Agent Two' });
        expect(within(panel).getByText('Detail agent-2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Agent Two/ })).toHaveAttribute('aria-current', 'true');
    });

    it('renders only the existing detail page below the breakpoint and skips list reads', async () => {
        layoutWidth = 640;
        const messaging = makeMessaging();
        renderShell(messaging, { route: 'cosigner-detail', initialId: 'agent-2' });

        expect(await screen.findByRole('heading', { level: 1, name: 'Standalone agent-2' })).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Agent accounts' })).toBeNull();
        expect(messaging.listCoSignerAccounts).not.toHaveBeenCalled();
        expect(messaging.getCoSignerAccountBalances).not.toHaveBeenCalled();
    });
});
