// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';
import { CrossChainTemplates } from '../../../packages/core/src/shared/routes/CrossChainTemplates.jsx';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function renderRoute(route, messaging) {
    return render(
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: vi.fn().mockResolvedValue({}), ...messaging }}
        >
            {route}
        </MessagingProvider>,
    );
}

describe('A through M route render coverage', () => {
    it('renders the agent accounts heading, empty state, and primary action', async () => {
        const onProvision = vi.fn();
        renderRoute(
            <CoSignerAccountList
                walletId="wallet-1"
                onBack={() => {}}
                onProvision={onProvision}
                onOpen={() => {}}
            />,
            { listCoSignerAccounts: vi.fn().mockResolvedValue([]) },
        );

        expect(screen.getByRole('heading', { level: 1, name: 'Agent accounts' })).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'No agent accounts yet' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'New agent account' }));
        expect(onProvision).toHaveBeenCalledTimes(1);
    });

    it('renders the provisioning heading, loading state, and primary action', async () => {
        const addresses = deferred();
        renderRoute(
            <CoSignerProvision walletId="wallet-1" onBack={() => {}} />,
            { getAddressesByChain: vi.fn(() => addresses.promise) },
        );

        expect(screen.getByRole('heading', { level: 1, name: 'New agent account' })).toBeTruthy();
        expect(screen.getByText('Loading wallet…')).toBeTruthy();

        addresses.resolve({
            'bitcoin-testnet': [{
                id: 'address-1',
                address: 'tb1qexample',
                publicKey: `02${'1'.repeat(64)}`,
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        });

        expect(await screen.findByRole('button', { name: 'Create agent account' })).toBeDisabled();
    });

    it('renders the template heading, primary actions, and empty state', async () => {
        const addresses = deferred();
        renderRoute(
            <CrossChainTemplates walletId="wallet-1" onBack={() => {}} onLaunch={() => {}} />,
            { getAddressesByChain: vi.fn(() => addresses.promise) },
        );

        expect(screen.getByRole('heading', { level: 1, name: 'Cross-chain templates' })).toBeTruthy();
        expect(screen.getByText('Loading templates…')).toBeTruthy();

        addresses.resolve({});

        expect(await screen.findByText('Two chains required')).toBeTruthy();
    });
});
