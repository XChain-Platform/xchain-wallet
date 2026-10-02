// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const { runConfirm } = vi.hoisted(() => ({ runConfirm: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            open: false,
            composing: false,
            confirmAction: {},
            run: runConfirm,
        }),
    };
});

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const MEMBER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function mount(getActionFormats) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getActionFormats,
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="2" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function ready(messaging) {
    await screen.findByLabelText('From');
    await waitFor(() => expect(messaging.getActionFormats).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: MEMBER } });
}

async function publish() {
    fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
    await waitFor(() => expect(runConfirm).toHaveBeenCalled());
    return runConfirm.mock.calls[0][0].actionData.params;
}

const V0 = { VERSION: '0', TYPE: '2', ITEM: [MEMBER] };
const WITH_META = { 2: {}, 3: {}, 4: {}, 5: {} };

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
    runConfirm.mockRejectedValue(new Error('stop after compose assertion'));
});

afterEach(cleanup);

describe('ListCreateForm name and description', () => {
    it.each([
        ['formats without 4 and 5', () => Promise.resolve({ 0: {}, 1: {}, 2: {}, 3: {} })],
        ['a null answer', () => Promise.resolve(null)],
        ['a throwing stub', () => Promise.reject(new Error('offline'))],
    ])('shows no inputs and sends version 0 on %s', async (_label, answer) => {
        const messaging = mount(vi.fn(answer));
        await ready(messaging);
        expect(screen.queryByLabelText('Name (optional)')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Description (optional)')).not.toBeInTheDocument();
        expect(await publish()).toEqual(V0);
    });

    it('sends version 4 with name and description when both formats exist', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        fireEvent.change(await screen.findByLabelText('Name (optional)'), { target: { value: 'Team' } });
        expect(await publish()).toEqual({
            VERSION: '4', TYPE: '2', NAME: 'Team', DESCRIPTION: '', ITEM: [MEMBER],
        });
    });

    it('sends today\'s version 0 params when both fields are empty', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        await screen.findByLabelText('Name (optional)');
        expect(await publish()).toEqual(V0);
    });

    it('carries the memo between description and items on version 4', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        fireEvent.change(await screen.findByLabelText('Description (optional)'), { target: { value: 'About' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'note' } });
        expect(await publish()).toEqual({
            VERSION: '4', TYPE: '2', NAME: '', DESCRIPTION: 'About', MEMO: 'note', ITEM: [MEMBER],
        });
    });

    it('shows an error and blocks review for a 65-byte name', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        fireEvent.change(await screen.findByLabelText('Name (optional)'), { target: { value: 'a'.repeat(65) } });
        expect(await screen.findByText('Too long.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
        expect(await screen.findByText('Fix the list name and description first.')).toBeInTheDocument();
        expect(runConfirm).not.toHaveBeenCalled();
    });

    it('shows an error and blocks review for a lone dash name', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        fireEvent.change(await screen.findByLabelText('Name (optional)'), { target: { value: '-' } });
        expect(await screen.findByText('A single - is not allowed.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
        await screen.findByText('Fix the list name and description first.');
        expect(runConfirm).not.toHaveBeenCalled();
    });

    it('counts a four-byte emoji as four bytes', async () => {
        const messaging = mount(vi.fn().mockResolvedValue(WITH_META));
        await ready(messaging);
        fireEvent.change(await screen.findByLabelText('Name (optional)'), { target: { value: '\u{1F600}' } });
        expect(await screen.findByText('4 / 64 bytes')).toBeInTheDocument();
    });
});
