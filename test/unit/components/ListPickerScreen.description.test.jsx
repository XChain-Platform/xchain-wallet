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
import { render, screen, waitFor } from '@testing-library/react';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';

function renderPicker(rows, detail = { type: '2', list: ['a', 'b'] }) {
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
        />,
    );
}

async function detailText(idx) {
    const title = await screen.findByText(new RegExp(`list #${idx}`));
    const button = title.closest('button');
    await waitFor(() => expect(button.lastChild.textContent).not.toMatch(/^counting…/));
    return button.lastChild.textContent;
}

describe('ListPickerScreen description detail', () => {
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
});
