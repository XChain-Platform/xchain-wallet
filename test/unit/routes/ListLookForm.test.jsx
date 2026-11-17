// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListLookForm } from '../../../packages/core/src/shared/routes/ListLookForm.jsx';
import { listTileId, readWalletTile } from '../../../packages/core/src/shared/utils/walletTile.js';

const CHAIN = 'bitcoin-mainnet';
const INDEX = '501';

function mount(props = {}) {
    const onBack = vi.fn();
    const onDone = vi.fn();
    const messaging = { getListByActionIndex: vi.fn().mockResolvedValue({ name: 'Friends' }) };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListLookForm chainId={CHAIN} actionIndex={INDEX} onBack={onBack} onDone={onDone} {...props} />
        </MessagingProvider>,
    );
    return { onBack, onDone };
}

beforeEach(() => { try { localStorage.clear(); } catch { /* storage may be blocked */ } });
afterEach(cleanup);

describe('ListLookForm (Edit look page)', () => {
    it('is a page with a back arrow, the Edit look title and the look fields, not a dialog', async () => {
        mount();
        expect(await screen.findByRole('heading', { name: 'Edit Look' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Back/ })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByRole('button', { name: /colour|color/i }).length).toBeGreaterThan(0);
    });

    it('is one flat form with no FormSection wrappers, fields in order, Save last', async () => {
        const { container } = render(
            <MessagingProvider shell="web" messaging={{ getListByActionIndex: vi.fn().mockResolvedValue({ name: 'Friends' }) }}>
                <ListLookForm chainId={CHAIN} actionIndex={INDEX} onBack={vi.fn()} onDone={vi.fn()} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: 'Save' });
        expect(container.querySelector('[data-form-section-title]')).toBeNull();
        expect(container.querySelector('[data-flat-look-form]')).toBeTruthy();
        const text = container.textContent;
        const order = ['Icon colour', 'Icon shape', 'Icon image', 'Save'].map((s) => text.indexOf(s));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('offers one full-width Save main action', async () => {
        mount();
        const save = await screen.findByRole('button', { name: 'Save' });
        expect(save).toHaveAttribute('type', 'submit');
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('Save stores the look and calls onDone', async () => {
        const { onDone, onBack } = mount();
        const swatches = screen.getAllByRole('button', { name: /colour|color/i });
        fireEvent.click(swatches[swatches.length - 1]);
        fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
        expect(readWalletTile(listTileId(CHAIN, INDEX)).colour).toBeTruthy();
    });

    it('Back returns without saving', async () => {
        const { onDone, onBack } = mount();
        const before = JSON.stringify(readWalletTile(listTileId(CHAIN, INDEX)));
        const swatches = screen.getAllByRole('button', { name: /colour|color/i });
        fireEvent.click(swatches[swatches.length - 1]);
        fireEvent.click(await screen.findByRole('button', { name: /^Back/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
        expect(JSON.stringify(readWalletTile(listTileId(CHAIN, INDEX)))).toBe(before);
    });
});
