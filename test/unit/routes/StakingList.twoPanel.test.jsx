// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Operator request 2026-11-15: on wide content Staking is two panels, as the
// DEX is (MarketsList.twoPanel.test.jsx): the stake list on the left and the
// picked stake's detail on the right. Narrower, a row opens Stake detail as a
// page, as before. Opened on its own route at a wide width, Stake detail is
// the same two panels with that stake picked.

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { DEX_TWO_PANEL_MIN_WIDTH } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qstakerstakerstakerstakerstakerxxx';
const VALIDATOR = { kind: 'validator', chainId: CHAIN, address: ADDRESS, stakeId: 's1' };
let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    // jsdom has no layout: the split's measured box reports the width under test.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return { width: layoutWidth, height: 800, top: 0, left: 0, right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {} };
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

// One staking address holding a validator stake (the newest row) and
// `contracts` contract stakes, so the row count grows while the address
// count stays one.
function makeMessaging(contracts, validatorStakes) {
    const contractStakes = Array.from({ length: contracts }, (_, i) => ({
        action_index: 100 + i,
        target_contract_index: String(i + 1),
        tick: 'XCHAIN',
        amount: String(10 + i),
        status: 'valid',
        block_index: 80 - i,
    }));
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ADDRESS }] }),
        getStakesForAddress: vi.fn().mockResolvedValue(validatorStakes || [
            { stake_id: 's1', action_index: 1, amount: '25', asset: 'XCHAIN', status: 'active', block_index: 90 },
        ]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([{ action_index: 2, amount: '3', status: 'valid', block_index: 95 }]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        getContractStakesForAddress: vi.fn().mockResolvedValue(contractStakes),
        getContractUnstakesForAddress: vi.fn().mockResolvedValue([]),
        getContractByActionIndex: vi.fn().mockResolvedValue({}),
        getSlashEventsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getSettings: vi.fn().mockResolvedValue({}),
    };
}

// A shell as web, desktop and the extension wire it: the pick lives in the
// shell's stakingRef, the right panel is the embedded Stake detail, and on the
// stake-detail route the narrow page is the standalone Stake detail.
function Shell({ route = 'staking-dashboard', initialRef = null, onOpenStake, onUnstake, onPick, onClaim }) {
    const [stakingRef, setStakingRef] = useState(initialRef);
    const detailFor = (ref, extra) => (
        <StakeDetail
            walletId="wallet-1"
            kind={ref.kind}
            chainId={ref.chainId}
            address={ref.address}
            contractActionIndex={ref.contractActionIndex}
            onUnstake={() => onUnstake?.(ref)}
            onClaimRewards={() => onClaim?.(ref)}
            {...extra}
        />
    );
    return (
        <StakingList
            walletId="wallet-1"
            onOpenStake={onOpenStake}
            onClaim={onClaim}
            onBack={() => {}}
            selectedStake={stakingRef}
            onSelectStake={(ref) => {
                onPick?.(ref);
                setStakingRef(ref);
            }}
            renderStake={(ref, panel) => detailFor(ref, { embedded: true, headerSlot: panel.toolsSlot, preloaded: panel.preloaded })}
            renderStakePage={route === 'stake-detail'
                ? (ref, page) => detailFor(ref, { onBack: () => {}, measureRef: page.measureRef })
                : undefined}
        />
    );
}

function renderShell(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell onOpenStake={vi.fn()} {...props} />
        </MessagingProvider>,
    );
}

const h1s = () => screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);

describe('StakingList two panels on wide content', () => {
    it('uses the DEX split width', () => {
        expect(LIST_DETAIL_MIN_WIDTH).toBe(DEX_TWO_PANEL_MIN_WIDTH);
    });

    it('shows the list beside the first stake, with one page header', async () => {
        layoutWidth = 1046; // Desktop 1280 beside its side menu
        renderShell(makeMessaging(2));

        const panel = await screen.findByRole('region', { name: 'Validator stake' });
        const list = screen.getByRole('button', { name: /^Open Contract #1 stake/ }).closest('[role="list"]');
        const listScroller = screen.getByRole('region', { name: 'Staking positions' });
        expect(listScroller).toContainElement(list);
        expect(listScroller).not.toContainElement(screen.getByRole('heading', { level: 1, name: 'Staking' }));
        expect(list.closest('[data-list-detail]')).toHaveAttribute('data-list-detail', 'two-panel');
        expect(panel.contains(list)).toBe(false);
        expect(screen.getByRole('separator', { name: 'Resize the staking list' })).toBeInTheDocument();
        // The stake's card names it; the page header stays Staking's.
        expect(await within(panel).findByText('Validator Stake')).toBeInTheDocument();
        expect(h1s()).toEqual(['Staking']);
        expect(document.querySelectorAll('main')).toHaveLength(1);
        // The first row (the newest stake) is the shown stake.
        const first = screen.getByRole('button', { name: /^Open Validator stake/ });
        expect(first).toHaveAttribute('aria-current', 'true');
        expect(first.closest('[role="listitem"]')).toHaveAttribute('data-selected', 'true');
        expect(screen.getByRole('button', { name: /^Open Contract #2 stake/ })).not.toHaveAttribute('aria-current');
    });

    it('remembers the dragged list width under the stable staking key', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(1));

        await screen.findByRole('region', { name: 'Validator stake' });
        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the staking list' }), { key: 'ArrowLeft' });

        const prefs = JSON.parse(localStorage.getItem('xc:displayPrefs'));
        expect(prefs.panelSplits.staking).toBeGreaterThan(0);
        expect(prefs.panelSplits).not.toHaveProperty('xc:stakingListWidth');
    });

    it('swaps the right panel when a second stake is clicked and leaves the list in place', async () => {
        layoutWidth = 1686; // Desktop 1920
        const onOpenStake = vi.fn();
        renderShell(makeMessaging(2), { onOpenStake });

        await screen.findByRole('region', { name: 'Validator stake' });
        const stakeList = () => screen.getByRole('button', { name: /^Open Contract #2 stake/ }).closest('[role="list"]');
        const list = stakeList();
        fireEvent.click(screen.getByRole('button', { name: /^Open Contract #2 stake/ }));

        const panel = await screen.findByRole('region', { name: 'Contract #2 stake' });
        expect(await within(panel).findByText('Contract #2 Stake')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Validator stake' })).toBeNull();
        expect(onOpenStake).not.toHaveBeenCalled();
        expect(stakeList()).toBe(list);
        expect(screen.getByRole('button', { name: /^Open Contract #2 stake/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /^Open Validator stake/ })).not.toHaveAttribute('aria-current');
        expect(h1s()).toEqual(['Staking']);
    });

    it('acts on the shown stake even when it was never picked (the default first stake)', async () => {
        layoutWidth = 1046;
        const onUnstake = vi.fn();
        const onPick = vi.fn();
        renderShell(makeMessaging(1), { onUnstake, onPick });

        const panel = await screen.findByRole('region', { name: 'Validator stake' });
        // The host's pick follows the shown stake, since the stake's forms read it.
        await waitFor(() => expect(onPick).toHaveBeenCalledWith(VALIDATOR));
        const actions = await within(panel).findByRole('list', { name: 'Stake actions' });
        fireEvent.click(within(actions).getByRole('button', { name: /^Unstake\b/ }));
        expect(onUnstake).toHaveBeenCalledWith(VALIDATOR);
    });
});

describe('StakingList below the split width', () => {
    it.each([
        ['iPad 834 is wide enough', 756, 'two-panel'],
        ['a phone in landscape', 640, 'list'],
        ['just under the threshold', LIST_DETAIL_MIN_WIDTH - 1, 'list'],
        ['no layout yet', 0, 'list'],
    ])('lays out for %s', async (_label, width, layout) => {
        layoutWidth = width;
        const onOpenStake = vi.fn();
        renderShell(makeMessaging(2), { onOpenStake });

        const row = await screen.findByRole('button', { name: /^Open Contract #1 stake/ });
        await waitFor(() => expect(row.closest('[data-list-detail]')).toHaveAttribute('data-list-detail', layout));
        if (layout === 'two-panel') return;
        // The old single page: no right panel, no selection, a row opens Stake detail.
        expect(screen.queryByRole('region', { name: /stake$/i })).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
        expect(row).not.toHaveAttribute('aria-current');
        fireEvent.click(row);
        expect(onOpenStake).toHaveBeenCalledWith({ kind: 'contract', chainId: CHAIN, address: ADDRESS, contractActionIndex: '1', stakeId: '100' });
    });
});

// Two validator stakes on one address share kind, chain and address, so the
// ref carries each stake's own identity: each row selects its own stake.
describe('StakingList two stakes on one address', () => {
    const twoStakes = [
        { stake_id: 'sA', amount: '25', asset: 'XCHAIN', status: 'active', block_index: 90 },
        { stake_id: 'sB', amount: '40', asset: 'XCHAIN', status: 'active', block_index: 85 },
    ];
    const rowButtons = () => screen.getAllByRole('button', { name: /^Open Validator stake/ });

    it('selects only the clicked stake and moves the selection between them', async () => {
        layoutWidth = 1046;
        const onPick = vi.fn();
        renderShell(makeMessaging(0, twoStakes), { onPick });
        await screen.findByRole('region', { name: 'Validator stake' });
        await waitFor(() => expect(rowButtons()).toHaveLength(2));

        const selected = () => rowButtons().map((b) => b.getAttribute('aria-current'));
        // The newest stake is shown first; exactly one row reads as selected.
        expect(selected()).toEqual(['true', null]);
        await waitFor(() => expect(onPick).toHaveBeenLastCalledWith({ ...VALIDATOR, stakeId: 'sA' }));

        fireEvent.click(rowButtons()[1]);
        await waitFor(() => expect(selected()).toEqual([null, 'true']));
        expect(onPick).toHaveBeenLastCalledWith({ ...VALIDATOR, stakeId: 'sB' });

        fireEvent.click(rowButtons()[0]);
        await waitFor(() => expect(selected()).toEqual(['true', null]));
        expect(onPick).toHaveBeenLastCalledWith({ ...VALIDATOR, stakeId: 'sA' });
    });

    it('gives stakes with no id of their own different identities too', async () => {
        layoutWidth = 1046;
        const onPick = vi.fn();
        renderShell(makeMessaging(0, [
            { amount: '25', asset: 'XCHAIN', status: 'active', block_index: 90 },
            { amount: '40', asset: 'XCHAIN', status: 'active', block_index: 85 },
        ]), { onPick });
        await waitFor(() => expect(rowButtons()).toHaveLength(2));
        fireEvent.click(rowButtons()[1]);
        await waitFor(() => expect(rowButtons().map((b) => b.getAttribute('aria-current'))).toEqual([null, 'true']));
        const ids = new Set(onPick.mock.calls.map(([ref]) => ref.stakeId));
        expect(ids.size).toBe(2);
    });

    it('keeps an older pick that has no stake identity to one row', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(0, twoStakes), {
            route: 'stake-detail',
            initialRef: { kind: 'validator', chainId: CHAIN, address: ADDRESS },
        });
        await waitFor(() => expect(rowButtons()).toHaveLength(2));
        await waitFor(() => expect(rowButtons().filter((b) => b.getAttribute('aria-current') === 'true')).toHaveLength(1));
    });
});

describe('StakingList claim controls', () => {
    it('keeps the ready-to-claim summary and its Claim button on a phone', async () => {
        layoutWidth = 402;
        const onClaim = vi.fn();
        const onOpenStake = vi.fn();
        renderShell(makeMessaging(1), { onClaim, onOpenStake });

        expect(await screen.findByText('ready to claim')).toBeInTheDocument();
        const claim = await screen.findByRole('button', { name: 'Claim' });
        fireEvent.click(claim);

        expect(onClaim).toHaveBeenCalledTimes(1);
        expect(onClaim.mock.calls[0][0]).toMatchObject({ kind: 'validator', chainId: CHAIN, address: ADDRESS });
        expect(onOpenStake).not.toHaveBeenCalled();
    });

    it.each([
        ['iPad 834', 756],
        ['Desktop 1920', 1686],
    ])('keeps the %s left panel list-only and claims from the selected stake on the right', async (_label, width) => {
        layoutWidth = width;
        const onClaim = vi.fn();
        renderShell(makeMessaging(1), { onClaim });

        const detail = await screen.findByRole('region', { name: 'Validator stake' });
        const listPanel = screen.getByRole('region', { name: 'Staking positions' });
        expect(within(listPanel).queryByText(/ready to claim/i)).toBeNull();
        expect(within(listPanel).queryByRole('button', { name: /^Claim\b/ })).toBeNull();

        const actions = await within(detail).findByRole('list', { name: 'Stake actions' });
        const claim = within(actions).getByRole('button', { name: /^Claim\b/ });
        expect(claim).not.toHaveAttribute('aria-disabled');
        fireEvent.click(claim);

        expect(onClaim).toHaveBeenCalledOnce();
        expect(onClaim).toHaveBeenCalledWith(VALIDATOR);
    });

    it('keeps Claim in the right panel when an unstaked address is still owed rewards', async () => {
        layoutWidth = 1046;
        const onClaim = vi.fn();
        renderShell(makeMessaging(0, []), { onClaim });

        const detail = await screen.findByRole('region', { name: 'Stake' });
        const listPanel = screen.getByRole('region', { name: 'Staking positions' });
        expect(within(listPanel).queryByText(/ready to claim/i)).toBeNull();
        expect(within(listPanel).queryByRole('button', { name: /^Claim\b/ })).toBeNull();

        const actions = await within(detail).findByRole('list', { name: 'Stake actions' });
        const claim = within(actions).getByRole('button', { name: /^Claim\b/ });
        expect(claim).not.toHaveAttribute('aria-disabled');
        fireEvent.click(claim);

        expect(onClaim).toHaveBeenCalledWith({ kind: 'validator', chainId: CHAIN, address: ADDRESS });
    });
});

describe('Stake detail opened on its own route', () => {
    it('is the two panels with that stake picked at a wide width', async () => {
        layoutWidth = 1046;
        const contract2 = { kind: 'contract', chainId: CHAIN, address: ADDRESS, contractActionIndex: '2' };
        renderShell(makeMessaging(2), { route: 'stake-detail', initialRef: contract2 });

        const panel = await screen.findByRole('region', { name: 'Contract #2 stake' });
        expect(await within(panel).findByText('Contract #2 Stake')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Open Contract #2 stake/ })).toHaveAttribute('aria-current', 'true');
        expect(h1s()).toEqual(['Staking']);
    });

    it('is the Stake detail page alone below the split width, and the list reads nothing', async () => {
        layoutWidth = 640;
        const messaging = makeMessaging(2);
        renderShell(messaging, { route: 'stake-detail', initialRef: VALIDATOR });

        expect(await screen.findByRole('heading', { level: 1, name: 'Validator Stake' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Open (Validator|Contract)/ })).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        // The page's own reads, once each, as before.
        await waitFor(() => expect(messaging.getStakesForAddress).toHaveBeenCalledTimes(1));
        expect(messaging.getContractStakesForAddress).not.toHaveBeenCalled();
    });
});

describe('StakingList two panels read counts', () => {
    // Every read the page makes, by name, once the list and the right panel settle.
    async function readsAt(contracts) {
        layoutWidth = 1046;
        const messaging = makeMessaging(contracts);
        const view = renderShell(messaging);
        const panel = await screen.findByRole('region', { name: 'Validator stake' });
        await within(panel).findByRole('list', { name: 'Stake actions' });
        await waitFor(() => expect(messaging.getValidatorsForChain).toHaveBeenCalled());
        await screen.findByRole('button', { name: new RegExp(`^Open Contract #${contracts} stake`) });
        const counts = Object.fromEntries(Object.entries(messaging).map(([name, fn]) => [name, fn.mock.calls.length]));
        view.unmount();
        return counts;
    }

    it('makes the same reads at 3 rows and at 9, and the right panel re-reads nothing the list read', async () => {
        const small = await readsAt(2);
        const large = await readsAt(8);
        expect(large).toEqual(small);
        // The list reads each lane once for its one address; the right panel
        // takes the stake's rows and the chain tip from the list.
        for (const name of [
            'getAddressesByChain', 'getStakesForAddress', 'getDelegationsForAddress', 'getRewardsForAddress',
            'getRewardClaimsForAddress', 'getContractStakesForAddress', 'getContractUnstakesForAddress', 'getIndexerWatermark',
        ]) {
            expect([name, small[name]]).toEqual([name, 1]);
        }
        // Only what the list never reads: the chain's validator roster.
        expect(small.getValidatorsForChain).toBe(1);
        expect(small.getSlashEventsForAddress).toBe(0);
    });
});
