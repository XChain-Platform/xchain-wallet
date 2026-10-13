// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const reachability = vi.hoisted(() => ({
    value: { overall: 'normal', perChain: [] },
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability.value,
}));

import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';

afterEach(() => {
    cleanup();
    reachability.value = { overall: 'normal', perChain: [] };
});

describe('NetworkStatusIndicator', () => {
    it('shows the connected state and links to network settings', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<AppHeader onOpenNetworkSettings={onOpenNetworkSettings} />);

        const header = screen.getByRole('region', { name: 'App header' });
        const trigger = screen.getByRole('button', { name: 'Network connected' });
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

        const trigger = screen.getByRole('button', { name: 'Network degraded: Litecoin, Dogecoin' });
        expect(trigger.closest('[data-state]')).toHaveAttribute('data-state', 'degraded');
        fireEvent.click(trigger);
        expect(screen.getByText('Litecoin').closest('li')).toHaveTextContent('Litecoin: explorer unavailable');
        expect(screen.getByText('Dogecoin').closest('li')).toHaveTextContent('Dogecoin: unreachable');
        expect(screen.queryByText(/Bitcoin:/)).toBeNull();
    });

    it('distinguishes a fully offline result without per-chain evidence', () => {
        reachability.value = { overall: 'offline', perChain: [] };
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);

        const trigger = screen.getByRole('button', {
            name: 'Network offline: no selected chain is reachable',
        });
        expect(trigger.closest('[data-state]')).toHaveAttribute('data-state', 'offline');
        fireEvent.click(trigger);
        expect(screen.getByText('No selected chain is reachable.')).toBeTruthy();
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
