// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    MY_TOKENS_PANEL_STORAGE_KEY,
    MyTokens,
} from '../../../packages/core/src/shared/routes/MyTokens.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt';
const TOKENS = [
    { tick: 'FIRST', description: 'First token', locked: false, divisibility: 8, youOwn: true },
    { tick: 'SECOND', description: 'Second token', locked: true, divisibility: 0, youOwn: true },
];

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return {
                width: layoutWidth,
                height: 800,
                top: 0,
                left: 0,
                right: layoutWidth,
                bottom: 800,
                x: 0,
                y: 0,
                toJSON() {},
            };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
});

function renderPage() {
    const onSelectTick = vi.fn();
    const renderToken = vi.fn((row) => (
        <section aria-label={`${row.tick} manage page`}>
            Plain identity for {row.tick}
        </section>
    ));
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS }],
        }),
        getOwnedTokens: vi.fn().mockResolvedValue(TOKENS),
    };
    const result = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MyTokens
                walletId="wallet-1"
                onBack={() => {}}
                onIssue={() => {}}
                onSelectTick={onSelectTick}
                renderToken={renderToken}
            />
        </MessagingProvider>,
    );
    return { ...result, messaging, onSelectTick, renderToken };
}

describe('My Tokens wide list and manage-token split', () => {
    it('uses the stable per-page storage key', () => {
        expect(MY_TOKENS_PANEL_STORAGE_KEY).toBe('my-tokens');
    });

    it('wires the embedded owner view in both wide shells', () => {
        for (const file of ['packages/web/src/App.jsx', 'packages/desktop/renderer/App.jsx']) {
            const source = readFileSync(file, 'utf8');
            expect(source).toContain('renderToken={(row) => renderTokenDetail({');
            expect(source).toContain('}, { embedded: true, ownerView: true })}');
        }
    });

    it.each([1046, 1686])('preselects the first token and swaps the detail without navigation at %ipx', async (width) => {
        layoutWidth = width;
        const { messaging, onSelectTick, renderToken } = renderPage();

        const firstPanel = await screen.findByRole('region', { name: 'FIRST token management' });
        expect(within(firstPanel).getByText('Plain identity for FIRST')).toBeInTheDocument();
        const listRegion = screen.getByRole('region', { name: 'My tokens' });
        const list = within(listRegion).getByRole('list');
        const first = within(listRegion).getByRole('button', { name: 'Open FIRST token details' });
        const second = within(listRegion).getByRole('button', { name: 'Open SECOND token details' });
        expect(first).toHaveAttribute('aria-current', 'true');
        expect(second).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('separator', { name: 'Resize the token list' })).toBeInTheDocument();
        expect(messaging.getOwnedTokens).toHaveBeenCalledTimes(1);
        expect(new Set(renderToken.mock.calls.map(([row]) => row.tick))).toEqual(new Set(['FIRST']));

        fireEvent.click(second);

        const secondPanel = await screen.findByRole('region', { name: 'SECOND token management' });
        expect(within(secondPanel).getByText('Plain identity for SECOND')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'FIRST token management' })).toBeNull();
        expect(screen.getByRole('region', { name: 'My tokens' })).toContainElement(list);
        expect(second).toHaveAttribute('aria-current', 'true');
        expect(first).not.toHaveAttribute('aria-current');
        expect(onSelectTick).not.toHaveBeenCalled();
    });

    it('keeps narrow row navigation and does not mount the embedded detail', async () => {
        layoutWidth = 640;
        const { onSelectTick, renderToken } = renderPage();

        const first = await screen.findByRole('button', { name: 'Open FIRST token details' });
        expect(document.querySelector('[data-list-detail="my-tokens-list"]')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /token management/ })).toBeNull();
        expect(renderToken).not.toHaveBeenCalled();

        fireEvent.click(first);

        await waitFor(() => expect(onSelectTick).toHaveBeenCalledWith(
            'FIRST',
            CHAIN,
            expect.objectContaining({ tick: 'FIRST', chainId: CHAIN, divisibility: 8 }),
        ));
    });
});
