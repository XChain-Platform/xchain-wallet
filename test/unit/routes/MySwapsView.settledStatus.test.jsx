// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My swaps must not offer Edit or Cancel on a swap the indexer already
// settled. The swap list feed (getSwapsForAddress) carries the indexer's
// latest lifecycle status inline on every row as `swap_status`: 'open' |
// 'complete' | 'cancelled' | 'expired', and the feed overlays the owner's
// edits as `state`. A 'complete' row once fell through to the expiration
// check and was shown as Open with live Edit and Cancel buttons.
//
// The list shows each row's status chip; Edit and Cancel live on the swap's
// details page (SwapDetail), which reads the swap's action detail.
//
// An older explorer's list reader may not carry `swap_status` at all; that
// is read as no information, not as "not settled", and falls through to
// the existing expiration/open logic unchanged.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    MySwapsView,
    deriveStatus,
    swapExpiryLabel,
} from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { SwapDetail } from '../../../packages/core/src/shared/routes/SwapDetail.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const swapViewCss = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/SwapViews.module.css',
), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Edit Swap's Give and Get facts sit in the shared FactRows value cells.
const factRowsCss = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/routes/FactRows.module.css',
), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

// A swap row as the list feed serves it. `swap_status` is the indexer's
// lifecycle status, absent on an older explorer's reader.
function swapRow(actionIndex, extra = {}) {
    return {
        action_index: String(actionIndex),
        source: OWN,
        give_tick: 'DOGESWAP',
        give_coin: 'DOGE',
        give_amount: '500',
        give_ownership: 0,
        get_tick: null,
        get_coin: 'DOGE',
        get_amount: '10.5',
        get_ownership: 0,
        expiration: FUTURE,
        block_index: '67882087',
        tx_hash: 'a'.repeat(64),
        status: 'valid',
        ...extra,
    };
}

// A cancel row as the swap_cancels feed serves it.
function cancelRow(actionIndex, swapActionIndex, status) {
    return { action_index: String(actionIndex), swap_action_index: String(swapActionIndex), source: OWN, status };
}

// A swap's action detail: its terms plus the live state block.
function swapDetail(actionIndex, status, expiration, extra = {}) {
    return { action: 'SWAP', ...swapRow(actionIndex, extra), state: { status, expiration } };
}

function harness({ swaps = [], cancels = [], details = {}, detailReader, cancelReader } = {}) {
    const composeForConfirm = vi.fn(async () => ({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT' }));
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSwapsForAddress: () => Promise.resolve({ data: swaps }),
        getSwapCancelsForAddress: cancelReader || (() => Promise.resolve({ data: cancels })),
        getSwapDetail: detailReader || (({ actionIndex }) => Promise.resolve(details[String(actionIndex)] ?? null)),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, composeForConfirm };
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(messaging, element) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging }, element));
        await drain();
    });
    return utils;
}

const open = (messaging) => mount(messaging, React.createElement(MySwapsView, { walletId: 'w', onBack() {} }));
const openDetail = (messaging, actionIndex) => mount(messaging, React.createElement(SwapDetail, {
    walletId: 'w', chainId: CHAIN, actionIndex: String(actionIndex), onBack() {},
}));

// A row is found by its swap key (the ring layout's row names the trade, not its number).
function rowFor(utils, actionIndex) {
    const list = utils.getByRole('list', { name: 'Swaps' });
    return list.querySelector(`[data-swap-row="${CHAIN}:${actionIndex}"]`);
}

// The facts sit under the Details tab once the page offers more than one action (G102).
function showDetails(utils) {
    const tab = utils.queryByRole('tab', { name: 'Details' });
    if (tab && tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab);
}

afterEach(() => cleanup());

describe('MySwapsView: settled status', () => {
    it.each([320, 360])('keeps the swap row and edit detail usable at %ipx', async (viewportWidth) => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });

        try {
            const longAmount = '12345678901234567890.12345678901234567890';
            const row = swapRow(640, { give_amount: longAmount, get_amount: longAmount });
            const { messaging } = harness({
                swaps: [row],
                details: { 640: swapDetail(640, 'open', FUTURE, { give_amount: longAmount, get_amount: longAmount }) },
            });
            const utils = await open(messaging);
            const listRow = rowFor(utils, 640);

            expect(within(listRow).getByRole('button', {
                name: `Open swap #640: give ${longAmount} DOGESWAP, get ${longAmount} DOGE, Open`,
            })).toBeTruthy();
            // The ring stands where the chip was: 0% for an open single-fill swap, its word under it.
            const ring = listRow.querySelector('[data-fill-ring]');
            expect(ring.getAttribute('data-percent')).toBe('0');
            expect(within(listRow).getByText('Open')).toBeTruthy();
            cleanup();

            const detail = await openDetail(messaging, 640);
            fireEvent.click(detail.getByRole('button', { name: /^Edit swap/ }));
            // The panel's facts are label-left rows; the lists are picker fields.
            const facts = detail.container.querySelector('dl[aria-label="Swap"]');
            // Displayed amounts group their thousands with every significant place kept (G123).
            const groupedAmount = '12,345,678,901,234,567,890.1234567890123456789';
            expect(facts.textContent).toContain(`Give${groupedAmount} DOGESWAP`);
            expect(facts.textContent).toContain(`Get${groupedAmount} DOGE`);
            expect(detail.getByRole('button', { name: 'Allow list: None set' })).toBeTruthy();
            expect(detail.getByRole('button', { name: 'Block list: None set' })).toBeTruthy();

            // Long values wrap inside the details and the chip never overflows its card;
            // the grouped facts wrap inside their shrinkable value cells.
            expect(ruleBody(factRowsCss, '.value')).toMatch(/overflow-wrap:\s*anywhere/);
            expect(ruleBody(factRowsCss, '.value')).toMatch(/min-width:\s*0/);
            expect(ruleBody(swapViewCss, '.mono')).toMatch(/overflow-wrap:\s*anywhere/);
            expect(ruleBody(swapViewCss, '.chip')).toMatch(/max-width:\s*100%/);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('shows a swap_status "complete" swap as Settled with no Edit or Cancel', async () => {
        const { messaging } = harness({
            swaps: [swapRow(665, { swap_status: 'complete' })],
            details: { 665: swapDetail(665, 'complete', FUTURE) },
        });
        const utils = await open(messaging);
        expect(within(rowFor(utils, 665)).getByText('Settled')).toBeTruthy();
        // A settled swap's ring is full, green, with a tick.
        const ring = rowFor(utils, 665).querySelector('[data-fill-ring]');
        expect(ring.getAttribute('data-percent')).toBe('100');
        expect(ring.getAttribute('data-mark')).toBe('tick');
        expect(ring.getAttribute('data-tone')).toBe('success');
        cleanup();

        const detail = await openDetail(messaging, 665);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Settled');
        expect(detail.queryByRole('button', { name: /^Edit swap/ })).toBeNull();
        expect(detail.queryByRole('button', { name: /^Cancel swap/ })).toBeNull();
        // The explorer and Copy transaction ID rows remain, so Actions comes first.
        const tabs = detail.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'Matches']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(detail.getByRole('link', { name: /^View on the explorer/ })).toBeTruthy();
        expect(detail.getByRole('button', { name: /^Copy transaction ID/ })).toHaveTextContent('aaaa…aaaa');
    });

    it('keeps a swap_status "open" swap with a future expiration Open with both actions', async () => {
        const { messaging } = harness({
            swaps: [swapRow(700, { swap_status: 'open' })],
            details: { 700: swapDetail(700, 'open', FUTURE) },
        });
        const utils = await open(messaging);
        expect(within(rowFor(utils, 700)).getByText('Open')).toBeTruthy();
        cleanup();

        const detail = await openDetail(messaging, 700);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Open');
        expect(detail.getByRole('button', { name: /^Edit swap/ })).toBeTruthy();
        expect(detail.getByRole('button', { name: /^Cancel swap/ })).toBeTruthy();
    });

    it('uses an edited expiration from the feed state on the list and from swap detail on the page', async () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const { messaging } = harness({
            swaps: [swapRow(702, { swap_status: 'open', expiration: past, state: { status: 'open', expiration: FUTURE } })],
            details: { 702: swapDetail(702, 'open', FUTURE, { expiration: past }) },
        });
        const utils = await open(messaging);
        const row = rowFor(utils, 702);
        // The feed state's later expiration keeps the row open.
        expect(within(row).getByText('Open')).toBeTruthy();
        cleanup();

        const detail = await openDetail(messaging, 702);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Open');
        showDetails(detail);
        expect(detail.getByTestId('swap-detail-expires').textContent).toMatch(/Expires .* \(.+ left\)/);
    });

    it('lets the detail lifecycle close an offer whose list row is stale', async () => {
        const { messaging } = harness({
            swaps: [swapRow(703, { swap_status: 'open' })],
            details: { 703: swapDetail(703, 'complete', FUTURE, { swap_status: 'open' }) },
        });
        const detail = await openDetail(messaging, 703);

        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Settled');
        expect(detail.queryByRole('button', { name: /^Edit swap/ })).toBeNull();
        expect(detail.queryByRole('button', { name: /^Cancel swap/ })).toBeNull();
    });

    it('refuses an action when a fresh detail says the swap settled', async () => {
        const detailReader = vi.fn()
            .mockResolvedValueOnce(swapDetail(705, 'open', FUTURE))
            .mockResolvedValueOnce(swapDetail(705, 'complete', FUTURE));
        const { messaging, composeForConfirm } = harness({
            swaps: [swapRow(705, { swap_status: 'open' })],
            detailReader,
        });
        const utils = await openDetail(messaging, 705);
        fireEvent.click(utils.getByRole('button', { name: /^Cancel swap/ }));
        fireEvent.click(utils.getByRole('button', { name: 'Cancel Swap' }));

        expect(await utils.findByText('This swap is no longer open. Refresh My swaps and try again.')).toBeTruthy();
        expect(detailReader).toHaveBeenCalledTimes(2);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses an action when a fresh cancel feed closes the swap', async () => {
        const cancelReader = vi.fn()
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [cancelRow(9000, 706, 'valid')] });
        const { messaging, composeForConfirm } = harness({
            swaps: [swapRow(706, { swap_status: 'open' })],
            details: { 706: swapDetail(706, 'open', FUTURE) },
            cancelReader,
        });
        const utils = await openDetail(messaging, 706);
        fireEvent.click(utils.getByRole('button', { name: /^Edit swap/ }));
        fireEvent.change(utils.getByLabelText('New expiration'), {
            target: { value: '2099-01-02T03:04' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Update Swap' }));

        expect(await utils.findByText('This swap is no longer open. Refresh My swaps and try again.')).toBeTruthy();
        expect(cancelReader).toHaveBeenCalledTimes(2);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('labels an expired offer in the past tense and removes its actions', async () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const { messaging } = harness({
            swaps: [swapRow(704, { swap_status: 'open', state: { status: 'open', expiration: past } })],
            details: { 704: swapDetail(704, 'open', past) },
        });
        const utils = await open(messaging);
        const row = rowFor(utils, 704);
        expect(within(row).getByText('Expired')).toBeTruthy();
        // An expired swap's ring is grey and shows the share it reached.
        const ring = row.querySelector('[data-fill-ring]');
        expect(ring.getAttribute('data-tone')).toBe('muted');
        expect(ring.getAttribute('data-percent')).toBe('0');
        cleanup();

        const detail = await openDetail(messaging, 704);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Expired');
        expect(detail.queryByRole('button', { name: /^Edit swap/ })).toBeNull();
        expect(detail.queryByRole('button', { name: /^Cancel swap/ })).toBeNull();
        showDetails(detail);
        expect(detail.getByTestId('swap-detail-expires')).toHaveTextContent(`Expired ${formatLocalDateTime(past)}`);
    });

    it('treats a missing swap_status as no information (older explorer compatibility)', async () => {
        const row = { key: `${CHAIN}:701`, row: swapRow(701) };
        delete row.row.swap_status;
        expect(deriveStatus(row, new Set(), 0)).toBe('open');

        const { messaging } = harness({ swaps: [swapRow(701)] });
        const utils = await open(messaging);
        expect(within(rowFor(utils, 701)).getByText('Open')).toBeTruthy();
    });

    it('lets a cancelled-feed row win over swap_status "complete"', () => {
        const item = { key: `${CHAIN}:9`, row: swapRow(9, { swap_status: 'complete' }) };
        expect(deriveStatus(item, new Set([`${CHAIN}:9`]), 0)).toBe('cancelled');
    });
});

describe('deriveStatus with swap_status', () => {
    const base = { key: `${CHAIN}:9` };

    it('maps the indexer statuses onto the view statuses, case- and space-insensitively', () => {
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'complete' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'COMPLETE' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: ' complete ' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'cancelled' }) }, new Set(), 0)).toBe('cancelled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'expired' }) }, new Set(), 0)).toBe('expired');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'open' }) }, new Set(), 0)).toBe('open');
    });

    it('falls through an unknown swap_status to the expiration check', () => {
        const pastExp = { ...base, row: swapRow(9, { swap_status: 'weird', expiration: 1 }) };
        expect(deriveStatus(pastExp, new Set(), 1000)).toBe('expired');
        const futureExp = { ...base, row: swapRow(9, { swap_status: 'weird' }) };
        expect(deriveStatus(futureExp, new Set(), 0)).toBe('open');
    });

    it('falls through a missing swap_status to the expiration check', () => {
        const row = swapRow(9, { expiration: 1 });
        delete row.swap_status;
        expect(deriveStatus({ ...base, row }, new Set(), 1000)).toBe('expired');
    });
});

describe('MySwapsView expiration display', () => {
    it('formats a deterministic countdown without changing the absolute deadline', () => {
        const now = 2_000_000_000;
        const expiration = now + 3661;
        expect(swapExpiryLabel(expiration, now)).toBe(
            `Expires ${formatLocalDateTime(expiration)} (1h 01m left)`,
        );
        expect(swapExpiryLabel(now + 2 * 86400 + 3 * 3600, now)).toBe(
            `Expires ${formatLocalDateTime(now + 2 * 86400 + 3 * 3600)} (2d 3h left)`,
        );
    });

    it('does not render a millisecond value as an expiration thousands of years away', async () => {
        const millis = String(Date.now());
        const { messaging } = harness({
            swaps: [swapRow(730, { state: { status: 'open', expiration: millis } })],
            details: { 730: swapDetail(730, 'open', millis) },
        });
        const utils = await open(messaging);
        expect(within(rowFor(utils, 730)).queryByText(/^Expires /)).toBeNull();
        cleanup();

        const detail = await openDetail(messaging, 730);
        showDetails(detail);
        expect(detail.getByTestId('swap-detail-index')).toBeTruthy();
        expect(detail.queryByTestId('swap-detail-expires')).toBeNull();
    });
});
