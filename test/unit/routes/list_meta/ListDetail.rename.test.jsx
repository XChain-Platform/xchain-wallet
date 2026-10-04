// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function renderList({ getActionFormats, onRename } = {}) {
    const messaging = {
        getListByActionIndex: vi.fn().mockResolvedValue(baseDetail),
        getActionFormats: getActionFormats || vi.fn().mockResolvedValue({}),
    };
    const onShare = vi.fn();
    const onTransfer = vi.fn();
    const props = {
        chainId: CHAIN_ID,
        actionIndex: ACTION_INDEX,
        onBack: () => {},
        onFork: () => {},
        onShare,
        onTransfer,
        ...(onRename ? { onRename } : {}),
    };

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail {...props} />
        </MessagingProvider>,
    );
    return { messaging, onShare, onTransfer };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListDetail rename action', () => {
    it('shows rename for LIST 4 and 5 support and passes the list reference', async () => {
        const onRename = vi.fn();
        const { messaging } = renderList({
            getActionFormats: vi.fn().mockResolvedValue({ 4: {}, 5: {} }),
            onRename,
        });

        expect(await screen.findByRole('button', { name: 'Share list' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Transfer list' })).toBeTruthy();
        fireEvent.click(await screen.findByRole('button', { name: 'Rename list' }));

        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onRename).toHaveBeenCalledWith({ chainId: CHAIN_ID, actionIndex: ACTION_INDEX });
        expect(messaging.getActionFormats).toHaveBeenCalledTimes(1);
        expect(messaging.getActionFormats).toHaveBeenCalledWith({ chainId: CHAIN_ID, action: 'LIST' });
    });

    it.each([
        ['neither metadata format', { 0: {}, 1: {} }],
        ['only LIST 4', { 4: {} }],
        ['only LIST 5', { 5: {} }],
    ])('hides rename with %s', async (_label, formats) => {
        const formatsRead = deferred();
        const getActionFormats = vi.fn(() => formatsRead.promise);
        renderList({
            getActionFormats,
            onRename: vi.fn(),
        });

        await screen.findByRole('button', { name: 'Share list' });
        await waitFor(() => expect(getActionFormats).toHaveBeenCalledTimes(1));
        await act(async () => formatsRead.resolve(formats));
        expect(screen.queryByRole('button', { name: 'Rename list' })).toBeNull();
    });

    it('hides rename when the format read rejects', async () => {
        const formatsRead = deferred();
        const getActionFormats = vi.fn(() => formatsRead.promise);
        renderList({ getActionFormats, onRename: vi.fn() });

        await screen.findByRole('button', { name: 'Share list' });
        await waitFor(() => expect(getActionFormats).toHaveBeenCalledTimes(1));
        await act(async () => formatsRead.reject(new Error('offline')));
        expect(screen.queryByRole('button', { name: 'Rename list' })).toBeNull();
    });

    it('hides rename when the callback is absent', async () => {
        const formatsRead = deferred();
        const getActionFormats = vi.fn(() => formatsRead.promise);
        renderList({ getActionFormats });

        await screen.findByRole('button', { name: 'Share list' });
        await waitFor(() => expect(getActionFormats).toHaveBeenCalledTimes(1));
        await act(async () => formatsRead.resolve({ 4: {}, 5: {} }));
        expect(screen.queryByRole('button', { name: 'Rename list' })).toBeNull();
    });
});
