// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression (xchain-wallet#57): Home's hero said "Total balance" while its
// rows hold only the active address on each chain, so a wallet with funds on
// other addresses showed a fraction of them under a label that read as the
// whole wallet. The hero names what it sums.

import { readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';

afterEach(() => {
    localStorage.clear();
});

describe('Home balance hero label', () => {
    it('labels the figure as the active address balance, not a wallet total', () => {
        const messaging = { getSettings: vi.fn(async () => ({})) };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TotalBalanceHero rows={[]} walletId="w1" networkFilter="all" />
            </MessagingProvider>,
        );
        expect(screen.getByRole('region', { name: 'Active address balance' })).toBeTruthy();
        expect(screen.queryByText(/Total balance/)).toBeNull();
    });

    // G11 and U12: the caption is the wallet name; a network filter never
    // appends the network's name ("Main Wallet · LITECOIN").
    it('keeps the caption to the wallet name while a network filter is on', () => {
        const messaging = { getSettings: vi.fn(async () => ({})) };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TotalBalanceHero rows={[]} walletId="w1" walletName="Main Wallet" networkFilter="litecoin" />
            </MessagingProvider>,
        );
        const region = screen.getByRole('region', { name: 'Main Wallet' });
        expect(region.textContent).not.toMatch(/litecoin/i);
    });

    it('renders the wallet switcher avatar primitive with the chosen wallet look', () => {
        localStorage.setItem('xc.walletTile.wallet-main', JSON.stringify({
            colour: '#123456',
            image: 'data:image/png;base64,d2FsbGV0',
            shape: 'rounded',
        }));
        const messaging = { getSettings: vi.fn(async () => ({})) };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TotalBalanceHero rows={[]} walletId="wallet-main" walletName="Main Wallet" networkFilter="all" />
            </MessagingProvider>,
        );

        const region = screen.getByRole('region', { name: 'Main Wallet' });
        const avatar = region.querySelector('[data-xc-avatar]');
        expect(avatar).not.toBeNull();
        expect(avatar).toHaveAttribute('aria-hidden', 'true');
        expect(avatar).toHaveAttribute('data-xc-avatar-context', 'header');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe('#123456');
        expect(avatar.parentElement.style.getPropertyValue('--xc-avatar-shape')).toBe('24%');
        expect(avatar.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,d2FsbGV0');
        expect(container.querySelectorAll('[data-xc-avatar]')).toHaveLength(1);
    });

    it('uses the switcher default avatar when the wallet has no saved look', () => {
        const messaging = { getSettings: vi.fn(async () => ({})) };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TotalBalanceHero rows={[]} walletId="wallet-main" walletName="Main Wallet" networkFilter="all" />
            </MessagingProvider>,
        );

        const avatar = screen.getByRole('region', { name: 'Main Wallet' }).querySelector('[data-xc-avatar]');
        expect(avatar).toHaveTextContent('MW');
        expect(avatar.querySelector('img')).toBeNull();
        expect(avatar.parentElement.style.getPropertyValue('--xc-avatar-shape')).toBe('50%');
    });

    it('matches the token hero caption artwork size, spacing and alignment', () => {
        const css = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');
        const labelRule = css.match(/\.label\.walletLabel\s*\{([^}]*)\}/)?.[1] || '';
        const iconRule = css.match(/\.walletLabelIcon\s*\{([^}]*)\}/)?.[1] || '';

        expect(labelRule).toMatch(/align-items:\s*center/);
        expect(labelRule).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(iconRule).toMatch(/--xc-avatar-size-header:\s*24px/);
        expect(iconRule).toMatch(/flex:\s*0 0 24px/);
    });
});
