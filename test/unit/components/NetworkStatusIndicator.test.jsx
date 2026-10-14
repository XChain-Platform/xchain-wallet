// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const reachability = vi.hoisted(() => ({
    value: { overall: 'normal', perChain: [] },
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability.value,
}));

import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

let nativeBack;
let capacitorApp;

beforeEach(() => {
    resetBackStackForTests();
    capacitorApp = {
        addListener: vi.fn((_event, listener) => {
            nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
    reachability.value = { overall: 'normal', perChain: [] };
});

describe('NetworkStatusIndicator', () => {
    it('is not rendered by AppHeader even when network settings are wired', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<AppHeader onOpenNetworkSettings={onOpenNetworkSettings} />);

        const header = screen.getByRole('region', { name: 'App header' });
        expect(header.querySelector('[data-state]')).toBeNull();
        expect(screen.queryByRole('button', { name: /Network connected/ })).toBeNull();
        expect(onOpenNetworkSettings).not.toHaveBeenCalled();
    });

    it('names every affected chain in a degraded state', () => {
        reachability.value = {
            overall: 'degraded',
            perChain: [
                { chainId: 'bitcoin-mainnet', mode: 'normal', services: { explorer: 'reachable' } },
                { chainId: 'litecoin-mainnet', mode: 'degraded', services: { explorer: 'unreachable' } },
                { chainId: 'dogecoin-mainnet', mode: 'offline', services: {} },
            ],
        };
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);

        const trigger = screen.getByRole('button', { name: 'Mainnet. Network degraded: Litecoin, Dogecoin' });
        expect(trigger.closest('[data-state]')).toHaveAttribute('data-state', 'degraded');
        fireEvent.click(trigger);
        expect(screen.getByText('Litecoin').closest('li')).toHaveTextContent('Litecoin: explorer unavailable');
        expect(screen.getByText('Dogecoin').closest('li')).toHaveTextContent('Dogecoin: unreachable');
        expect(screen.queryByText(/Bitcoin:/)).toBeNull();
    });

    it('keeps repeated chain rows uniquely keyed', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        reachability.value = {
            overall: 'degraded',
            perChain: [
                { chainId: 'litecoin-mainnet', mode: 'degraded', services: {} },
                { chainId: 'litecoin-mainnet', mode: 'offline', services: {} },
            ],
        };

        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
        fireEvent.click(screen.getByRole('button', {
            name: 'Mainnet. Network degraded: Litecoin, Litecoin',
        }));

        expect(screen.getAllByText('Litecoin')).toHaveLength(2);
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key" prop/i);
    });

    it('distinguishes a fully offline result without per-chain evidence', () => {
        reachability.value = { overall: 'offline', perChain: [] };
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);

        const trigger = screen.getByRole('button', {
            name: 'Mainnet. Network offline: no selected chain is reachable',
        });
        expect(trigger.closest('[data-state]')).toHaveAttribute('data-state', 'offline');
        fireEvent.click(trigger);
        expect(screen.getByText('No selected chain is reachable.')).toBeTruthy();
    });

    it('closes the dialog on Android Back instead of minimizing the app', () => {
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
        const trigger = screen.getByRole('button', { name: /Network connected/ });
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        act(() => nativeBack({ canGoBack: false }));

        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveFocus();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });

    it('is not wired into the shared application header', () => {
        const source = readFileSync(join(
            process.cwd(),
            'packages/core/src/shared/components/AppHeader.jsx',
        ), 'utf8');
        expect(source).not.toContain('NetworkStatusIndicator');
        expect(source).not.toContain('onOpenNetworkSettings');
    });
});
