// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A DeFi row on Home carries the same Back-sized forward chevron as a Coins
// or Tokens row, in the activity row's trailing slot and clipped to its
// middle third, and is two lines at a Coins row's height with no block line.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    const value = { messaging: {}, shell: 'web' };
    return { useMessaging: () => value };
});
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import homeTabsStyles from '../../../packages/core/src/shared/components/HomeTabs.module.css';

const CSS = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/HomeTabs.module.css'), 'utf8');
const BALANCE_CSS = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/BalanceList.module.css'), 'utf8');
const rule = (css, selector) => css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] || '';

const chainRegistry = { byCoin: () => [], get: () => null, all: () => [] };
const positions = [{
    id: 'stake-1', kind: 'stake', action: 'STAKE', status: 'confirmed',
    title: 'XCHAIN stake', primary: '50,000 XCHAIN', secondary: '', badge: 'Active',
    blockIndex: 12_420, timestamp: 1_760_000_000, confirms: 8,
    chain: 'BITCOIN', chainId: 'bitcoin-mainnet', address: 'owner', actionIndex: '1',
}];

function mountDefi(onSelectEntry) {
    const view = render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId="real-wallet"
            networkFilter="all"
            coinFamilies={[]}
            defiPositions={positions}
            onSelectEntry={onSelectEntry}
        />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'DeFi' }));
    return view;
}

afterEach(() => cleanup());

describe('HomeTabs DeFi row chevron and height', () => {
    it('puts the forward chevron in the row\'s trailing slot when the row opens', () => {
        const { container } = mountDefi(vi.fn());
        const row = container.querySelector('li > button');
        const chevron = row.querySelector(`.${homeTabsStyles.rowChevron}`);
        expect(chevron).not.toBeNull();
        expect(chevron.parentElement.getAttribute('aria-hidden')).toBe('true');
        expect(chevron.querySelector('svg')).not.toBeNull();
        expect(row).not.toHaveTextContent(/Block/);
    });

    it('draws no chevron on a row that does not open', () => {
        const { container } = mountDefi(undefined);
        expect(container.querySelector(`.${homeTabsStyles.rowChevron}`)).toBeNull();
    });

    it('sizes and clips the chevron exactly as the Coins and Tokens rows do', () => {
        for (const css of [CSS, BALANCE_CSS]) {
            const box = rule(css, '.rowChevron');
            expect(box).toMatch(/--xc-icon-size:\s*32px/);
            expect(box).toMatch(/width:\s*calc\(var\(--xc-icon-size\) \/ 3\)/);
            expect(box).toMatch(/overflow:\s*hidden/);
        }
    });

    it('lays the row out on two lines at a Coins row\'s height with no block area', () => {
        const row = rule(CSS, '.defiRow.defiRow.defiRow');
        expect(row).toMatch(/"mark label label status trailing"\s*"mark primary primary time trailing";/);
        expect(row).not.toMatch(/block/);
        expect(row).toMatch(/min-height:\s*calc\(var\(--xc-control-h-lg\) \+ 2 \* var\(--xc-list-row-padding\)\)/);
    });
});
