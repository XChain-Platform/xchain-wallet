// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import networkFilterStyles from '../../../packages/core/src/shared/components/NetworkFilter.module.css';
import networkFilterDropdownStyles from '../../../packages/core/src/shared/components/NetworkFilterDropdown.module.css';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qcontrolrowexampleexampleexampleexample',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messaging(overrides = {}) {
    return new Proxy({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        ...overrides,
    }, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function mount(child, methods) {
    return render(
        <MessagingProvider shell="web" messaging={methods}>
            {child}
        </MessagingProvider>,
    );
}

function expectMediumInput(input) {
    expect(input.parentElement?.parentElement).toHaveClass(inputStyles.md);
}

afterEach(() => cleanup());

describe('route control row alignment', () => {
    it('keeps contract search, filter chips, and publish action on the md size', async () => {
        mount(
            <ContractsList
                walletId="wallet-1"
                onBack={() => {}}
                onOpenContract={() => {}}
                onDeploy={() => {}}
            />,
            messaging({
                getContractsForSource: vi.fn().mockResolvedValue({ data: [] }),
                getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
                getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
                getContractsBrowseAll: vi.fn().mockResolvedValue({ data: [] }),
            }),
        );

        expectMediumInput(await screen.findByLabelText('Filter contracts'));
        expect(screen.getByRole('tab', { name: 'All' })).toHaveClass(buttonStyles.md);
        expect(screen.getByRole('tab', { name: 'Bitcoin' })).toHaveClass(buttonStyles.md);
        expect(screen.getByRole('button', { name: /Publish contract/ })).toHaveClass(buttonStyles.md);
    });

    it('keeps staking search and network filter on the md size', async () => {
        mount(
            <StakingList
                walletId="wallet-1"
                onBack={() => {}}
                onOpenStake={() => {}}
            />,
            messaging({
                getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            }),
        );

        expectMediumInput(await screen.findByLabelText('Search staking positions'));
        const networkFilter = screen.getByRole('button', { name: 'Filter by network' });
        expect(networkFilter.parentElement).toHaveClass(networkFilterStyles.md);
        expect(networkFilter.parentElement?.parentElement).toHaveClass(networkFilterDropdownStyles.md);
    });

    it('keeps oracle action buttons and outcome chips on the md size', async () => {
        mount(
            <OracleConsole
                walletId="wallet-1"
                onBack={() => {}}
                onOpenMarket={() => {}}
                onDuplicate={() => {}}
            />,
            messaging({
                betFeeds: vi.fn().mockResolvedValue({ data: [{
                    action_index: '42',
                    source: ADDRESS.address,
                    label: 'Rain tomorrow',
                    outcomes: 'Yes,No',
                    feed_status: 'closed',
                    deadline: 2_000_000_000,
                    expire_at: 2_000_003_600,
                }] }),
            }),
        );

        const view = await screen.findByRole('button', { name: 'View market' });
        const copy = screen.getByRole('button', { name: 'Copy to a new market' });
        expect(view).toHaveClass(buttonStyles.md);
        expect(copy).toHaveClass(buttonStyles.md);

        fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
        const outcomes = screen.getByRole('group', { name: 'Winning outcome' });
        for (const chip of within(outcomes).getAllByRole('button')) {
            expect(chip).toHaveClass(buttonStyles.md);
        }
    });
});
