// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Renaming a list now happens in the one List form that Edit opens (walk
// 2026-11-13, Layout 1), so the detail page has no Rename tile and no longer
// reads the LIST metadata formats to decide whether to show one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../../packages/core/src/shared/routes/ListDetail.jsx';

const CHAIN_ID = 'bitcoin-testnet';
const ACTION_INDEX = '77';
const baseDetail = {
    type: '0',
    status: 'valid',
    source: 'owner',
    list: [],
};

function renderList({ onRename, onEdit } = {}) {
    const messaging = {
        getListByActionIndex: vi.fn().mockResolvedValue(baseDetail),
        getActionFormats: vi.fn().mockResolvedValue({ 4: {}, 5: {} }),
    };
    const props = {
        chainId: CHAIN_ID,
        actionIndex: ACTION_INDEX,
        onBack: () => {},
        onFork: () => {},
        onShare: vi.fn(),
        onTransfer: vi.fn(),
        ...(onRename ? { onRename } : {}),
        ...(onEdit ? { onEdit } : {}),
    };

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail {...props} />
        </MessagingProvider>,
    );
    return { messaging };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListDetail rename goes through Edit', () => {
    it('shows no Rename tile even when the shell passes onRename and the formats exist', async () => {
        const onRename = vi.fn();
        const { messaging } = renderList({ onRename });

        expect(await screen.findByRole('button', { name: /^Share\b/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Transfer\b/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
        expect(messaging.getActionFormats).not.toHaveBeenCalled();
        expect(onRename).not.toHaveBeenCalled();
    });

    it('sends Edit to the edit handler with the list reference', async () => {
        const onEdit = vi.fn();
        renderList({ onEdit });

        fireEvent.click(await screen.findByRole('button', { name: /^Edit(?! look)\b/ }));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN_ID, actionIndex: ACTION_INDEX }));
    });
});
