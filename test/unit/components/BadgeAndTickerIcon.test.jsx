// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

import { WatchOnlyBadge } from '../../../packages/core/src/shared/components/WatchOnlyBadge.jsx';
import {
    DispenserBadge,
    __clearDispenserBadgeCache,
} from '../../../packages/core/src/shared/components/DispenserBadge.jsx';
import { TickerIcon } from '../../../packages/core/src/shared/components/TickerIcon.jsx';

beforeEach(() => {
    __clearDispenserBadgeCache();
    messaging = {
        getDispensersForToken: vi.fn().mockResolvedValue([{ status: 'valid' }]),
    };
});

afterEach(() => cleanup());

describe('badge presentation', () => {
    it('uses the shared compact badge scale and semantic color tokens', async () => {
        render(
            <>
                <WatchOnlyBadge visible />
                <DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />
            </>,
        );

        const watchOnly = screen.getByRole('status', { name: 'Watch-only wallet' });
        const dispenser = await screen.findByRole('status', {
            name: '1 open dispenser for XCHAIN on bitcoin-mainnet',
        });

        for (const badge of [watchOnly, dispenser]) {
            expect(badge.style.fontSize).toBe('var(--xc-text-xs)');
            expect(badge.style.padding).toBe('2px var(--xc-space-2)');
            expect(badge.style.borderRadius).toBe('var(--xc-radius-pill)');
        }
        expect(watchOnly.style.background).toBe('var(--xc-warning-bg)');
        expect(watchOnly.style.color).toBe('var(--xc-warning-text)');
        expect(dispenser.style.color).toBe('var(--xc-accent-text)');
    });

    it('keeps a long dispenser ticker available while truncating its visual label', async () => {
        const tick = 'A-VERY-LONG-TICKER-NAME-THAT-MUST-NOT-GROW-THE-ROW';
        render(<DispenserBadge chainId="bitcoin-mainnet" tick={tick} />);

        const badge = await screen.findByRole('status', {
            name: `1 open dispenser for ${tick} on bitcoin-mainnet`,
        });
        const label = screen.getByText(`Dispenser · ${tick}`);

        expect(badge).toHaveAttribute('title', `1 open dispenser for ${tick} on bitcoin-mainnet`);
        expect(badge.style.maxWidth).toBe('100%');
        expect(label.style.overflow).toBe('hidden');
        expect(label.style.textOverflow).toBe('ellipsis');
        expect(label.style.whiteSpace).toBe('nowrap');
    });

    it('does not apply an in-flight result from a replaced messaging transport', async () => {
        let resolveFirst;
        const firstRequest = new Promise((resolve) => { resolveFirst = resolve; });
        const firstMessaging = {
            getDispensersForToken: vi.fn().mockReturnValue(firstRequest),
        };
        const secondMessaging = {
            getDispensersForToken: vi.fn().mockResolvedValue([
                { status: 'valid' },
                { status: 'valid' },
            ]),
        };
        messaging = firstMessaging;
        const { rerender } = render(<DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />);
        await waitFor(() => expect(firstMessaging.getDispensersForToken).toHaveBeenCalledOnce());

        messaging = secondMessaging;
        rerender(<DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />);

        expect(await screen.findByRole('status', {
            name: '2 open dispensers for XCHAIN on bitcoin-mainnet',
        })).toBeInTheDocument();
        expect(secondMessaging.getDispensersForToken).toHaveBeenCalledOnce();

        await act(async () => {
            resolveFirst([{ status: 'valid' }]);
            await firstRequest;
        });
        expect(screen.getByRole('status')).toHaveAccessibleName(
            '2 open dispensers for XCHAIN on bitcoin-mainnet',
        );
    });

    it('contains synchronous messaging failures and caches the empty result', async () => {
        messaging = {
            getDispensersForToken: vi.fn(() => {
                throw new Error('transport unavailable');
            }),
        };
        const { unmount } = render(<DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />);
        await waitFor(() => expect(messaging.getDispensersForToken).toHaveBeenCalledOnce());
        expect(screen.queryByRole('status')).toBeNull();

        unmount();
        render(<DispenserBadge chainId="bitcoin-mainnet" tick="XCHAIN" />);
        await act(async () => {});

        expect(messaging.getDispensersForToken).toHaveBeenCalledOnce();
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('TickerIcon', () => {
    it('names a native asset and keeps its default size stable', () => {
        render(<TickerIcon chainId="bitcoin-mainnet" tick="BTC" />);

        const icon = screen.getByRole('img', { name: /BTC on /i });
        expect(icon.style.width).toBe('28px');
        expect(icon.style.height).toBe('28px');
        expect(icon.querySelector('img')).toHaveAttribute('alt', '');
    });

    it('names a token fallback and uses theme tokens for foreground and pip colors', () => {
        render(<TickerIcon chainId="bitcoin-mainnet" tick="XCHAIN" size={32} />);

        const icon = screen.getByRole('img', { name: /XCHAIN on /i });
        const fallback = icon.firstElementChild;
        const pip = icon.querySelector('img');

        expect(icon.style.width).toBe('32px');
        expect(fallback.style.color).toBe('var(--xc-text-inverted)');
        expect(pip.style.background).toBe('var(--xc-surface-raised)');
    });
});
