// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import historyStyles from '../../../packages/core/src/shared/routes/History.module.css';
import { userEvent } from '../../helpers/userEvent.js';

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
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
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
    render(
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

        const trigger = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(trigger).toBeEnabled());
        trigger.focus();
        await user.keyboard('{Enter}');

        const dialog = await screen.findByRole('dialog', { name: 'Export history' });
        const controls = Array.from(dialog.querySelectorAll('input, button'));
        expect(controls).toHaveLength(17);
        await waitFor(() => expect(controls[0]).toHaveFocus());
        for (const control of controls.slice(1)) {
            await user.tab();
            expect(control).toHaveFocus();
        }
        await user.tab();
        expect(controls[0]).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('is enabled for visible rows and disabled with a reason when filters hide them', async () => {
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'no such transaction' },
        });

        await waitFor(() => expect(button).toBeDisabled());
        expect(screen.getByText('No rows match the current filters.')).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-describedby', 'history-export-disabled-reason');
    });

    it('hides export controls when there is no history', async () => {
        mountHistory([]);

        await screen.findByText('No activity yet');
        expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
        expect(screen.queryByText('There are no history rows to export.')).toBeNull();
    });

    it('stacks the rendered footer and reserves the bottom bar at 360px', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });

        try {
            mountHistory([historyRow()]);
            const trigger = await screen.findByRole('button', { name: 'Export…' });
            const footer = trigger.closest(`.${historyStyles.resultsHeader}`);
            const exportControls = trigger.closest(`.${historyStyles.exportControls}`);
            const phone = mediaBlock(historyCss, 'not all and (min-width: 480px)');

            expect(window.innerWidth).toBe(360);
            expect(footer).not.toBeNull();
            expect(exportControls).not.toBeNull();
            expect(ruleBody(phone, '.resultsHeader')).toMatch(
                /flex-direction:\s*column[\s\S]*align-items:\s*stretch/,
            );
            expect(ruleBody(phone, '.exportControls')).toMatch(
                /flex-direction:\s*column[\s\S]*align-items:\s*stretch/,
            );
            expect(ruleBody(phone, '.exportTrigger')).toMatch(
                /width:\s*100%[\s\S]*box-sizing:\s*border-box/,
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
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(await screen.findByRole('dialog', { name: 'Export history' })).toBeInTheDocument();
        expect(screen.getByText('Fiat currency (EUR)')).toBeInTheDocument();
    });

    it('leaves the export dialog closed on e when there is no history', async () => {
        mountHistory([]);

        await screen.findByText('No activity yet');
        expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
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

        const open = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(open).toBeEnabled());
        fireEvent.click(open);
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
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        fireEvent.click(screen.getByLabelText(/^JSON/));
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
