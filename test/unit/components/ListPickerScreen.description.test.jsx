// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';

function renderPicker(rows, detail = { type: '2', list: ['a', 'b'] }, overrides = {}) {
    const messaging = {
        getListsForSource: vi.fn().mockResolvedValue(rows),
        getListByActionIndex: vi.fn().mockResolvedValue(detail),
    };
    render(
        <ListPickerScreen
            variant="full"
            messaging={messaging}
            chainId="c"
            addresses={[{ address: 'addr1' }]}
            filterType="2"
            onSelect={() => {}}
            onBack={() => {}}
            {...overrides}
        />,
    );
    return messaging;
}

async function detailText(idx) {
    const title = await screen.findByText(new RegExp(`list #${idx}`));
    const button = title.closest('button');
    await waitFor(() => expect(button.lastChild.textContent).not.toMatch(/^counting…/));
    return button.lastChild.textContent;
}

describe('ListPickerScreen description detail', () => {
    it('renders an empty result through the shared list page and empty state', async () => {
        renderPicker([]);

        const title = await screen.findByText('No address lists yet');
        expect(screen.getByText('Address lists published from this chain appear here.')).toBeTruthy();
        expect(title.tagName).toBe('P');
        expect(title.parentElement.className).toMatch(/wrap/);
        expect(title.parentElement.parentElement.className).toMatch(/page/);
        expect(title.parentElement).not.toHaveAttribute('role');
    });

    it('shows a plain load failure and retries without exposing backend text', async () => {
        const messaging = {
            getListsForSource: vi.fn()
                .mockRejectedValueOnce(new Error('getListsForSource: GET /api/lists failed'))
                .mockResolvedValueOnce([]),
            getListByActionIndex: vi.fn(),
        };
        renderPicker([], undefined, { messaging });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Couldn’t load lists. Check your connection and try again.');
        expect(alert).not.toHaveTextContent('/api/lists');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('No address lists yet')).toBeInTheDocument();
        expect(messaging.getListsForSource).toHaveBeenCalledTimes(2);
    });

    it('shows the load failure when the source read throws synchronously', async () => {
        const messaging = {
            getListsForSource: vi.fn(() => { throw new Error('synchronous failure'); }),
            getListByActionIndex: vi.fn(),
        };
        renderPicker([], undefined, { messaging });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Couldn’t load lists. Check your connection and try again.',
        );
    });

    it('reloads detail for the same action index after the chain changes', async () => {
        const messaging = {
            getListsForSource: vi.fn().mockResolvedValue([{ action_index: '10', type: '2' }]),
            getListByActionIndex: vi.fn(async ({ chainId }) => (
                chainId === 'first'
                    ? { type: '2', list: ['a'] }
                    : { type: '2', list: ['a', 'b'] }
            )),
        };
        const props = {
            variant: 'full',
            messaging,
            addresses: [{ address: 'addr1' }],
            filterType: '2',
            onSelect: vi.fn(),
            onBack: vi.fn(),
        };
        const { rerender } = render(<ListPickerScreen {...props} chainId="first" />);
        await waitFor(() => expect(screen.getByText('1 member')).toBeInTheDocument());

        rerender(<ListPickerScreen {...props} chainId="second" />);

        await waitFor(() => expect(screen.getByText('2 members')).toBeInTheDocument());
        expect(messaging.getListByActionIndex).toHaveBeenCalledWith({
            chainId: 'second',
            actionIndex: '10',
        });
    });

    it('omits rows without an action index', async () => {
        renderPicker([
            { tx_hash: 'first', type: '2' },
            { tx_hash: 'second', type: '2' },
            { action_index: '10', type: '2' },
        ]);

        expect(await screen.findByText(/list #10/)).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.queryByText(/list #\?/)).toBeNull();
    });

    it('omits rejected lists from access-filter choices', async () => {
        renderPicker([
            { action_index: '10', type: '2', status: 'valid' },
            { action_index: '11', type: '2', status: 'invalid: TYPE' },
        ]);

        expect(await screen.findByText(/list #10/)).toBeTruthy();
        expect(screen.queryByText(/list #11/)).toBeNull();
    });

    it('shows a described row description after the member count', async () => {
        const detail = Promise.withResolvers();
        renderPicker(
            [{ action_index: '10', type: '2', description: 'Holders of the gold tier' }],
            detail.promise,
        );
        const title = await screen.findByText(/list #10/);
        expect(title.closest('button').lastChild.textContent).toBe('counting…');
        detail.resolve({ type: '2', list: ['a', 'b'] });
        expect(await detailText('10')).toBe('2 members · Holders of the gold tier');
    });

    it('shows today\'s text for an undescribed row', async () => {
        renderPicker([{ action_index: '10', type: '2' }]);
        expect(await detailText('10')).toBe('2 members');
    });

    it('groups large member counts', async () => {
        renderPicker(
            [{ action_index: '10', type: '2' }],
            { type: '2', list: Array.from({ length: 1234 }, (_, index) => `member-${index}`) },
        );
        expect(await detailText('10')).toBe('1,234 members');
    });

    it('shows today\'s text for an empty description', async () => {
        renderPicker([{ action_index: '10', type: '2', description: '' }]);
        expect(await detailText('10')).toBe('2 members');
    });

    it('shows today\'s text for a non-string description', async () => {
        renderPicker([
            { action_index: '10', type: '2', description: 42 },
            { action_index: '11', type: '2', description: { text: 'x' } },
        ]);
        expect(await detailText('10')).toBe('2 members');
        expect(await detailText('11')).toBe('2 members');
    });

    it('renders a description carrying U+202E neutralized', async () => {
        renderPicker([{ action_index: '10', type: '2', description: 'evil‮txt' }]);
        const text = await detailText('10');
        expect(text).toBe('2 members · evil␦txt');
        expect(text).not.toContain('‮');
    });

    it('searches list names, indices, kinds, statuses, and descriptions', async () => {
        renderPicker([
            { action_index: '10', type: '2', name: 'Treasury', description: 'Long-term holders' },
            { action_index: '11', type: '2', name: 'Payroll', status: 'pending' },
        ]);
        await screen.findByText('Treasury (List #10)');

        const search = screen.getByRole('textbox', { name: 'Search lists' });
        for (const [query, match, miss] of [
            ['payROLL', 'Payroll (List #11) (pending)', 'Treasury (List #10)'],
            ['10', 'Treasury (List #10)', 'Payroll (List #11) (pending)'],
            ['address', 'Treasury (List #10)', null],
            ['pending', 'Payroll (List #11) (pending)', 'Treasury (List #10)'],
            ['holders', 'Treasury (List #10)', 'Payroll (List #11) (pending)'],
        ]) {
            fireEvent.change(search, { target: { value: query } });
            expect(screen.getByText(match)).toBeInTheDocument();
            if (miss) expect(screen.queryByText(miss)).toBeNull();
        }
    });

    it('shows a filtered empty state without replacing the list template', async () => {
        renderPicker([{ action_index: '10', type: '2', name: 'Treasury' }]);
        await screen.findByText('Treasury (List #10)');

        fireEvent.change(screen.getByRole('textbox', { name: 'Search lists' }), {
            target: { value: 'missing' },
        });

        expect(screen.getByText('No matching lists')).toBeInTheDocument();
        expect(screen.getByText('Try a different search.')).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Search lists' })).toBeInTheDocument();
    });

    it('selects a list with its value and cancels without selecting on Back', async () => {
        const onSelect = vi.fn();
        const onBack = vi.fn();
        renderPicker(
            [{ action_index: '10', type: '2', name: 'Treasury' }],
            { type: '2', list: ['a', 'b'] },
            { onSelect, onBack },
        );
        await waitFor(() => expect(screen.getByText('2 members')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).toHaveBeenCalledOnce();
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('Treasury (List #10)').closest('button'));
        expect(onSelect).toHaveBeenCalledWith({
            actionIndex: '10',
            type: '2',
            memberCount: 2,
            name: 'Treasury',
        });
    });
});
