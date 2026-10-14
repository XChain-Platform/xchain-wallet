// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';

const reachability = vi.hoisted(() => ({
    value: { overall: 'normal', perChain: [] },
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability.value,
}));

import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { VIEWPORT_CLAMP_MARGIN } from '../../../packages/core/src/shared/hooks/useViewportClamp.js';
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
    it('keeps the closed popover out of the header Tab order', async () => {
        const user = userEvent.setup();
        render(
            <AppHeader
                onOpenNetworkSettings={() => {}}
                onOpenSettings={() => {}}
                onLock={() => {}}
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Network connected' });
        const popover = document.querySelector('[role="dialog"][aria-label="Network status"]');
        expect(popover).toHaveAttribute('hidden');
        expect(popover).toHaveAttribute('inert');

        await user.tab();
        expect(trigger).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Lock wallet' })).toHaveFocus();

        fireEvent.click(trigger);
        expect(popover).not.toHaveAttribute('hidden');
        expect(popover).not.toHaveAttribute('inert');
    });

    it('shows the connected state and links to network settings', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<AppHeader onOpenNetworkSettings={onOpenNetworkSettings} />);

        const header = screen.getByRole('region', { name: 'App header' });
        const trigger = screen.getByRole('button', { name: 'Mainnet. Network connected' });
        expect(header).toContainElement(trigger);
        expect(trigger.closest('[data-state]')).toHaveAttribute('data-state', 'normal');
        fireEvent.click(trigger);
        expect(screen.getByText('All selected chains are reachable.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Network settings' }));
        expect(onOpenNetworkSettings).toHaveBeenCalledOnce();
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

    it('keeps the popover inside a 360px viewport beside either edge', () => {
        const viewport = 360;
        const popoverWidth = 280;
        let trigger = { left: 12, right: 50, bottom: 52 };
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: viewport,
        });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            if (this.getAttribute('aria-label') === 'Network connected') {
                return {
                    ...trigger,
                    top: 14,
                    width: 38,
                    height: 38,
                    x: trigger.left,
                    y: 14,
                    toJSON() {},
                };
            }
            if (this.getAttribute('role') === 'dialog') {
                const left = Number.parseFloat(this.style.left) || 0;
                return {
                    left,
                    top: 58,
                    right: left + popoverWidth,
                    bottom: 258,
                    width: popoverWidth,
                    height: 200,
                    x: left,
                    y: 58,
                    toJSON() {},
                };
            }
            return {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                width: 0,
                height: 0,
                x: 0,
                y: 0,
                toJSON() {},
            };
        });

        for (const expectedLeft of [VIEWPORT_CLAMP_MARGIN, 68]) {
            const view = render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
            fireEvent.click(screen.getByRole('button', { name: 'Network connected' }));
            const panel = screen.getByRole('dialog', { name: 'Network status' });
            const left = Number.parseFloat(panel.style.left);
            expect(left).toBe(expectedLeft);
            expect(left).toBeGreaterThanOrEqual(VIEWPORT_CLAMP_MARGIN);
            expect(left + popoverWidth).toBeLessThanOrEqual(viewport - VIEWPORT_CLAMP_MARGIN);
            view.unmount();
            trigger = { left: 310, right: 348, bottom: 52 };
        }
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

    it('is wired into every unlocked shell header', () => {
        const shellPaths = [
            'packages/web/src/App.jsx',
            'packages/desktop/renderer/App.jsx',
            'packages/extension/src/popup/App.jsx',
        ];
        for (const path of shellPaths) {
            const source = readFileSync(join(process.cwd(), path), 'utf8');
            expect(source, path).toMatch(/<AppHeader\b/);
            expect(source, path).toMatch(/onOpenNetworkSettings=\{/);
            expect(source, path).toContain("openSettingsSection('network-endpoints')");
        }
    });
});
