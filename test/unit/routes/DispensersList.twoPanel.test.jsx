// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const CHAIN = 'bitcoin-testnet';
const OWNER = 'tb1qownerownerownerownerownerownerownerow';
const ROWS = [
    {
        action_index: '40', block_index: 200, source: OWNER,
        give_tick: 'ALPHA', give_amount: '2', get_coin: 'BTC', get_amount: '0.00001',
        status: 'valid', current_status: 'open', escrow_remaining: '48',
    },
    {
        action_index: '31', block_index: 150, source: OWNER,
        give_tick: 'BETA', give_amount: '1', get_coin: 'BTC', get_amount: '0.00002',
        status: 'valid', current_status: 'open', escrow_remaining: '24',
    },
];
const listSource = readFileSync('packages/core/src/shared/routes/DispensersList.jsx', 'utf8');
const detailSource = readFileSync('packages/core/src/shared/routes/DispenserDetail.jsx', 'utf8');
const shellSources = [
    'packages/web/src/App.jsx',
    'packages/extension/src/popup/App.jsx',
    'packages/desktop/renderer/App.jsx',
].map((path) => readFileSync(path, 'utf8'));

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
    try { globalThis.localStorage?.clear(); } catch { /* no storage */ }
});

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }],
        }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: ROWS }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: ROWS }),
    };
}

function Shell({ route = 'dispensers-list', initialRef = null, onOpenDispenser = vi.fn(), onPick = vi.fn() }) {
    const [selected, setSelected] = useState(initialRef);
    return (
        <DispensersList
            walletId="wallet-1"
            onBack={() => {}}
            onOpenDispenser={onOpenDispenser}
            selectedDispenser={selected}
            onSelectDispenser={(ref) => { onPick(ref); setSelected(ref); }}
            renderDispenser={(ref) => <h2>{`Detail ${ref.actionIndex}`}</h2>}
            renderDispenserPage={route === 'dispenser-detail'
                ? (ref, page) => (
                    <main ref={page.measureRef} data-list-detail="page">
                        <h1>{`Dispenser ${ref.actionIndex}`}</h1>
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

describe('DispensersList two panels', () => {
    it('wires the embedded and standalone detail into every shell', () => {
        expect(detailSource).toContain('if (embedded) return page;');
        for (const source of shellSources) {
            expect(source).toContain('selectedDispenser={dispenserRef}');
            expect(source).toContain('marketAsset={dispenserMarketAsset}');
            expect(source).toContain("setUnlockedView('dispensers-picker')");
            expect(source).toContain('renderDispenser={(ref) => renderDispenserDetail(ref, { embedded: true })}');
            expect(source).toContain("renderDispenserPage={unlockedView === 'dispenser-detail'");
        }
    });

    it('shows the list beside the first dispenser and remembers its divider width', async () => {
        layoutWidth = 1046;
        const onPick = vi.fn();
        renderShell(makeMessaging(), { onPick });
        fireEvent.click(screen.getByRole('radio', { name: 'My Dispensers' }));

        const panel = await screen.findByRole('region', { name: 'ALPHA dispenser #40' });
        expect(within(panel).getByRole('heading', { name: 'Detail 40' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Dispensers' })).toBeInTheDocument();
        expect(document.querySelectorAll('main')).toHaveLength(1);
        const first = screen.getByRole('button', { name: 'Open ALPHA dispenser #40' });
        expect(first).toHaveAttribute('aria-current', 'true');
        expect(first.closest('li')).toHaveAttribute('data-selected', 'true');
        await waitFor(() => expect(onPick).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '40' }));

        const divider = screen.getByRole('separator', { name: 'Resize the dispensers list' });
        const before = Number(divider.getAttribute('aria-valuenow'));
        fireEvent.keyDown(divider, { key: 'ArrowRight' });
        expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
        expect(listSource).toContain('storageKey="dispensers"');
    });

    it('swaps the detail in place without invoking narrow navigation', async () => {
        layoutWidth = 1686;
        const onOpenDispenser = vi.fn();
        renderShell(makeMessaging(), { onOpenDispenser });
        fireEvent.click(screen.getByRole('radio', { name: 'My Dispensers' }));
        const list = await screen.findByRole('region', { name: 'Dispensers' });

        fireEvent.click(screen.getByRole('button', { name: 'Open BETA dispenser #31' }));
        const panel = await screen.findByRole('region', { name: 'BETA dispenser #31' });
        expect(within(panel).getByRole('heading', { name: 'Detail 31' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Dispensers' })).toBe(list);
        expect(onOpenDispenser).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Open BETA dispenser #31' })).toHaveAttribute('aria-current', 'true');
    });

    it.each([
        ['iPad beside its icon rail', 756, true],
        ['phone landscape', 640, false],
        ['just below the threshold', LIST_DETAIL_MIN_WIDTH - 1, false],
    ])('uses the responsive layout at %s', async (_label, width, split) => {
        layoutWidth = width;
        const onOpenDispenser = vi.fn();
        renderShell(makeMessaging(), { onOpenDispenser });
        fireEvent.click(screen.getByRole('radio', { name: 'My Dispensers' }));
        const row = await screen.findByRole('button', { name: 'Open BETA dispenser #31' });
        if (split) {
            expect(await screen.findByRole('region', { name: 'ALPHA dispenser #40' })).toBeInTheDocument();
            expect(screen.getByRole('separator')).toBeInTheDocument();
            return;
        }
        expect(screen.queryByRole('separator')).toBeNull();
        expect(row).not.toHaveAttribute('aria-current');
        fireEvent.click(row);
        expect(onOpenDispenser).toHaveBeenCalledWith(CHAIN, '31');
    });
});

describe('Dispenser detail route', () => {
    it('keeps a deep-linked dispenser selected in the wide split', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(), {
            route: 'dispenser-detail',
            initialRef: { chainId: CHAIN, actionIndex: '31' },
        });
        const panel = await screen.findByRole('region', { name: 'BETA dispenser #31' });
        expect(within(panel).getByText('Detail 31')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open BETA dispenser #31' })).toHaveAttribute('aria-current', 'true');
    });

    it('keeps the standalone detail page below the breakpoint and skips list reads', async () => {
        layoutWidth = 640;
        const messaging = makeMessaging();
        renderShell(messaging, {
            route: 'dispenser-detail',
            initialRef: { chainId: CHAIN, actionIndex: '31' },
        });
        expect(await screen.findByRole('heading', { level: 1, name: 'Dispenser 31' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Open .* dispenser/ })).toBeNull();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(messaging.getDispensersForSource).not.toHaveBeenCalled();
    });
});
