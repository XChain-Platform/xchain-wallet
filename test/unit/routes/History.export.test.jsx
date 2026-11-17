// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import historyStyles from '../../../packages/core/src/shared/routes/History.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { userEvent } from '../../helpers/userEvent.js';
import {
    EXPORT_ITEM,
    MORE_ACTIONS,
    REFRESH_ITEM,
    chooseHistoryMenuItem,
    historyMenuItem,
    historyMoreButton,
    queryHistoryMenuItem,
} from './historyMoreMenu.js';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const historyCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/History.module.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

function mediaBlock(text, query) {
    const blocks = [];
    let cursor = 0;
    while (cursor < text.length) {
        const start = text.indexOf(`@media ${query}`, cursor);
        if (start < 0) break;
        const open = text.indexOf('{', start);
        let depth = 0;
        for (let index = open; index < text.length; index += 1) {
            if (text[index] === '{') depth += 1;
            if (text[index] === '}') depth -= 1;
            if (depth !== 0) continue;
            blocks.push(text.slice(open + 1, index));
            cursor = index + 1;
            break;
        }
    }
    return blocks.join('\n');
}

function mountHistory(rows) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" />
        </MessagingProvider>,
    );
}

function historyRow() {
    return {
        action: 'SEND',
        action_index: 12,
        block_index: 100,
        timestamp: Math.floor(Date.now() / 1000),
        tx_hash: 'abc123',
        details: {
            source: ADDRESS,
            destination: 'mrecipient',
            tick: 'LTC',
            amount: '1.25',
            memo: 'visible row',
        },
    };
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('History export button', () => {
    it('tabs through every export choice, wraps focus, and returns focus after Escape', async () => {
        const user = userEvent.setup();
        mountHistory([historyRow()]);

        // Export sits in the title line's ⋯ menu; it opens the dialog from
        // the keyboard: Tab from ⋯ onto the item, then Enter.
        const more = await screen.findByRole('button', { name: MORE_ACTIONS });
        await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeEnabled());
        more.focus();
        await user.tab();
        expect(historyMenuItem(EXPORT_ITEM)).toHaveFocus();
        await user.keyboard('{Enter}');

        const dialog = await screen.findByRole('dialog', { name: 'Export history' });
        const dialogQueries = within(dialog);
        // The dialog's tab sequence in document order: the Format and Columns
        // labels each carry a '?' help tip (ruling 2026-11-13) ahead of their
        // choices, then the Format dropdown (G119, no radios), the checkboxes
        // and the buttons.
        const controls = Array.from(dialog.querySelectorAll('button, input'))
            .filter((element) => !element.disabled);
        expect(dialogQueries.queryAllByRole('radio')).toHaveLength(0);
        expect(controls).toHaveLength(
            dialogQueries.getAllByRole('checkbox').length
            + dialogQueries.getAllByRole('button').length,
        );
        expect(controls).toHaveLength(18);
        const formatTip = dialogQueries.getByRole('button', { name: 'About Format' });
        const columnsTip = dialogQueries.getByRole('button', { name: 'About Columns' });
        const formatField = dialogQueries.getByRole('button', { name: /^Format: CSV/ });
        expect(formatField.querySelector('svg')).not.toBeNull();
        expect(controls.indexOf(formatTip)).toBeLessThan(controls.indexOf(formatField));
        expect(controls.indexOf(columnsTip)).toBeLessThan(controls.indexOf(dialogQueries.getAllByRole('checkbox')[0]));
        await waitFor(() => expect(controls).toContain(document.activeElement));
        const start = controls.indexOf(document.activeElement);
        // One full lap: every control in turn, wrapping from the last back to the first.
        for (let step = 1; step <= controls.length; step += 1) {
            await user.tab();
            expect(controls[(start + step) % controls.length]).toHaveFocus();
        }
        expect(controls[start]).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
        // The menu item that opened the dialog closed with the menu, so focus
        // goes back to the ⋯ button that holds it.
        await waitFor(() => expect(more).toHaveFocus());
    });

    it('is enabled for visible rows and disabled with a reason when filters hide them', async () => {
        mountHistory([historyRow()]);

        await screen.findByRole('button', { name: MORE_ACTIONS });
        await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeEnabled());
        expect(historyMenuItem(EXPORT_ITEM)).not.toHaveAttribute('title');
        fireEvent.click(historyMoreButton());
        expect(screen.queryByRole('menu')).toBeNull();

        // The search box lives in the title-line filter menu.
        fireEvent.click(screen.getByRole('button', { name: 'History filters' }));
        fireEvent.change(await screen.findByLabelText('Search history'), {
            target: { value: 'no such transaction' },
        });

        // The item stays in the menu, disabled, and its title gives the reason.
        await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeDisabled());
        expect(historyMenuItem(EXPORT_ITEM))
            .toHaveAttribute('title', 'No rows match the current filters.');
    });

    it('hides export controls when there is no history', async () => {
        mountHistory([]);

        await screen.findByText('No activity yet');
        // The ⋯ menu still offers Refresh; Export joins it only once there is history.
        expect(historyMenuItem(REFRESH_ITEM)).toBeInTheDocument();
        expect(queryHistoryMenuItem(EXPORT_ITEM)).toBeNull();
        expect(screen.queryByText('There are no history rows to export.')).toBeNull();
    });

    it('keeps the kit controls together in a standard-height wrapping toolbar at 360px', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });

        try {
            mountHistory([historyRow()]);
            const trigger = await screen.findByRole('button', { name: MORE_ACTIONS });
            await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeEnabled());
            const exportItem = historyMenuItem(EXPORT_ITEM);
            fireEvent.click(trigger);
            // The filters, Show fiat and Grouping sit in the title-line filter menu.
            const filterButton = screen.getByRole('button', { name: 'History filters' });
            fireEvent.click(filterButton);
            expect(filterButton).toHaveAttribute('aria-expanded', 'true');
            const showFiat = screen.getByRole('button', { name: 'Show fiat: Off' });
            const grouping = screen.getByRole('radiogroup', { name: 'Grouping mode' });
            const toolbar = showFiat.parentElement;
            const phone = mediaBlock(historyCss, 'not all and (min-width: 480px)');

            expect(window.innerWidth).toBe(360);
            expect(toolbar).not.toBeNull();
            expect(grouping.parentElement).toBe(toolbar);
            // Export sits in the ⋯ menu, an outlined icon button on the title
            // line right of the filter (G02, G95): nothing sits between the
            // header and the list, and it stays reachable with the filters
            // closed.
            expect(trigger.closest('[data-history-header-actions]')).not.toBeNull();
            const titleLine = screen.getByRole('heading', { name: 'History', level: 1 }).closest('div');
            expect(titleLine.contains(trigger)).toBe(true);
            expect(exportItem.closest('#history-filter-panel')).toBeNull();
            expect(document.querySelector('[data-xc-page-actions]')).toBeNull();
            expect(trigger.closest('#history-filter-panel')).toBeNull();
            expect(trigger.closest(`.${historyStyles.filterFooter}`)).toBeNull();
            for (const control of [showFiat, grouping]) {
                expect(control).toHaveClass(historyStyles.toolbarControl);
            }
            expect(trigger).toHaveClass(historyStyles.headerIconButton);
            expect(showFiat).toHaveAttribute('aria-pressed', 'false');
            expect(trigger).toHaveClass(buttonStyles.secondary);
            expect(ruleBody(historyCss, '.filterFooter')).toMatch(
                /display:\s*flex[\s\S]*flex-wrap:\s*wrap/,
            );
            expect(ruleBody(historyCss, '.toolbarControl')).toMatch(
                /flex:\s*0 0 auto[\s\S]*height:\s*var\(--xc-control-h-md\)[\s\S]*min-height:\s*var\(--xc-control-h-md\)/,
            );
            expect(ruleBody(phone, '.body')).toMatch(
                /padding-bottom:\s*calc\(3\.5rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
            );
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
            else Reflect.deleteProperty(window, 'innerWidth');
        }
    });
});

describe('History export shortcut (§34.2)', () => {
    it('opens the export dialog on e when rows are visible', async () => {
        const { container } = mountHistory([historyRow()]);

        // The shortcut needs no menu: once a row shows, e opens the dialog.
        await waitFor(() => expect(container.querySelector('[data-history-key]')).not.toBeNull());
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(await screen.findByRole('dialog', { name: 'Export history' })).toBeInTheDocument();
        expect(screen.getByText('Fiat currency (EUR)')).toBeInTheDocument();
    });

    it('leaves the export dialog closed on e when there is no history', async () => {
        mountHistory([]);

        await screen.findByText('No activity yet');
        expect(queryHistoryMenuItem(EXPORT_ITEM)).toBeNull();
        fireEvent.click(historyMoreButton());
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
    });
});

describe('large History export', () => {
    it('reports chunk progress, cancels safely, and emits valid JSON on retry', async () => {
        const rows = Array.from({ length: 501 }, (_, index) => ({
            ...historyRow(),
            action_index: index + 1,
            tx_hash: `tx-${index + 1}`,
        }));
        mountHistory(rows);

        await screen.findByRole('button', { name: MORE_ACTIONS });
        await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeEnabled());
        chooseHistoryMenuItem(EXPORT_ITEM);
        vi.useFakeTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        expect(screen.getByText('Preparing 0 of 501 rows…')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(16); });
        expect(screen.getByText('Preparing 250 of 501 rows…')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();

        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history-test');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        vi.stubGlobal('Blob', NodeBlob);
        chooseHistoryMenuItem(EXPORT_ITEM);
        // Format is the themed dropdown (G119): open it, pick JSON.
        fireEvent.click(screen.getByRole('button', { name: /^Format: / }));
        fireEvent.click(screen.getByRole('option', { name: /^JSON/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });

        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
        const blob = createObjectURL.mock.calls[0][0];
        expect(blob.type).toBe('application/json');
        const exported = JSON.parse(await blob.text());
        expect(exported.entries).toHaveLength(501);
        expect(exported.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
