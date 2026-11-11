// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every wallet's DeFi tab draws its rows with the shared activity row, so a DeFi
// row reads like a Home activity or History row: a status badge from the
// row's own labels, no confirmation-count pill and no "Unconfirmed" text.

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
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({}),
    useTokenFiatRates: () => ({}),
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

const NOW = 1_760_000_000;
const positions = vi.hoisted(() => [
    {
        id: 'stake-confirmed', kind: 'stake', action: 'STAKE', status: 'confirmed',
        title: 'XCHAIN stake', primary: '50,000.00000000 XCHAIN', secondary: '', badge: 'Active',
        blockIndex: 12_420, timestamp: 1_760_000_000 - 60, confirms: 8,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', address: 'owner', actionIndex: '1',
    },
    {
        id: 'dispenser-pending', kind: 'dispenser', action: 'DISPENSER', status: 'pending',
        title: 'DEMOCOIN dispenser', primary: '500 DEMOCOIN remaining', secondary: '', badge: 'Open',
        blockIndex: null, timestamp: 1_760_000_000 - 120, confirms: 0,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'DEMOCOIN', address: 'owner', actionIndex: '2',
    },
    {
        id: 'contract-failed', kind: 'contract', action: 'CONTRACT', status: 'failed',
        title: 'BTC vault contract', primary: '0.25 BTC locked', secondary: '', badge: 'Vault',
        blockIndex: 12_395, timestamp: 1_760_000_000 - 180, confirms: 27,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'BTC', address: 'owner', actionIndex: '3',
    },
    {
        id: 'order-confirmed', kind: 'order', action: 'ORDER', status: 'confirmed',
        title: 'Open order', primary: '2 RAREPEPE offered', secondary: '', badge: 'Open',
        blockIndex: 12_390, timestamp: 1_760_000_000 - 240, confirms: 30,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'RAREPEPE', address: 'owner', actionIndex: '4',
    },
    {
        id: 'swap-confirmed', kind: 'swap', action: 'SWAP', status: 'confirmed',
        title: 'Open swap', primary: '1 RAREPEPE offered', secondary: '', badge: 'Open',
        blockIndex: 12_385, timestamp: 1_760_000_000 - 300, confirms: 35,
        chain: 'BITCOIN', chainId: 'bitcoin-mainnet', tick: 'RAREPEPE', address: 'owner', actionIndex: '5',
    },
]);
vi.mock('@xchain-wallet/core/flows', () => ({
    isDemoWallet: (walletId) => walletId === 'demo-wallet',
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const chainRegistry = {
    byCoin: () => [],
    get: (chainId) => (chainId === 'bitcoin-mainnet'
        ? { id: chainId, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }
        : null),
    all: () => [],
};

afterEach(() => cleanup());

function mountDefi(onSelectEntry = vi.fn(), walletId = 'real-wallet') {
    const view = render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{}}
            walletId={walletId}
            networkFilter="all"
            coinFamilies={[]}
            defiPositions={positions}
            onSelectEntry={onSelectEntry}
        />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'DeFi' }));
    return { ...view, onSelectEntry };
}

function defiRows(container) {
    return [...container.querySelectorAll('li > button')];
}

describe('HomeTabs DeFi rows', () => {
    it('draws every real-wallet DeFi type with the shared activity row', () => {
        const { container } = mountDefi();
        const rows = defiRows(container);
        expect(rows).toHaveLength(positions.length);
        for (const row of rows) {
            expect(row.hasAttribute('data-activity-row')).toBe(true);
            expect(row.querySelector('[data-asset-mark]')).not.toBeNull();
        }
        expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
            expect.stringContaining('Stake'),
            expect.stringContaining('Dispenser'),
            expect.stringContaining('Contract'),
            expect.stringContaining('Order'),
            expect.stringContaining('Swap'),
        ]));
    });

    it('draws demo order and swap positions through that same list', () => {
        const { container } = mountDefi(vi.fn(), 'demo-wallet');
        const labels = defiRows(container).map((row) => row.textContent);
        expect(labels.some((label) => label.includes('Order'))).toBe(true);
        expect(labels.some((label) => label.includes('Swap'))).toBe(true);
    });

    it('shows no confirmation count or unconfirmed text on any row', () => {
        const { container } = mountDefi();
        for (const row of defiRows(container)) {
            for (const node of row.querySelectorAll('*')) {
                expect(node.textContent).not.toMatch(/confirms|unconfirmed/i);
            }
        }
    });

    it('labels each row with the shared status badge', () => {
        const { container } = mountDefi();
        const statuses = defiRows(container).map((row) => row.querySelector('[title]')?.textContent);
        expect(statuses).toEqual(['Pending', 'Confirmed', 'Failed', 'Confirmed', 'Confirmed']);
    });

    it('shows blocks only for settled DeFi rows', () => {
        const { container } = mountDefi();
        const rows = defiRows(container);
        expect(rows[0]).not.toHaveTextContent(/Block/);
        expect(rows[0].querySelector('time')).not.toBeNull();
        expect(rows[1]).toHaveTextContent('Block 12,420');
        expect(rows[2]).toHaveTextContent('Block 12,395');
        expect(rows[3]).toHaveTextContent('Block 12,390');
        expect(rows[4]).toHaveTextContent('Block 12,385');
    });

    it('opens the History-shaped entry for the clicked row', () => {
        const { container, onSelectEntry } = mountDefi();
        fireEvent.click(defiRows(container)[0]);
        expect(onSelectEntry).toHaveBeenCalledTimes(1);
        const entry = onSelectEntry.mock.calls[0][0];
        expect(entry).toMatchObject({
            key: 'bitcoin-mainnet:2:owner',
            chainId: 'bitcoin-mainnet',
            address: 'owner',
            actionIndex: '2',
            action: 'DISPENSER',
            blockIndex: 0,
            timestamp: NOW - 120,
            txHash: '',
            source: 'owner',
            link: null,
        });
        expect(entry.raw).toMatchObject({ id: 'dispenser-pending', status: 'pending' });
    });
});
