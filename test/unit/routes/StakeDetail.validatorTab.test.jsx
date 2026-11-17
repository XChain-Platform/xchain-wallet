// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { ownValidatorRow } from '../../../packages/core/src/flows/stakingDashboard.js';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qoperatoroperatoroperatoroperatoroperator';
const OTHER = 'bc1qsomeoneelsesomeoneelsesomeoneelsesomeone';
const KEY = 'c'.repeat(64);

afterEach(cleanup);

function mount(roster, { delegations } = {}) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue([{ source: ADDRESS, amount: '12.5', asset: 'XCHAIN', status: 'valid', block_index: 150 }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue(delegations ?? [{ source: ADDRESS, signing_pubkey: KEY, status: 'valid', block_index: 160 }]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getValidatorsForChain: vi.fn().mockResolvedValue(roster),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 200 }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeDetail
                walletId="wallet-1"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS}
                onBack={vi.fn()}
                onUnstake={vi.fn()}
                onClaimRewards={vi.fn()}
                onDelegate={vi.fn()}
                onRevokeDelegation={vi.fn()}
            />
        </MessagingProvider>,
    );
    return messaging;
}

function valueOf(list, label) {
    return within(list).getByText(label).closest('li');
}

describe('StakeDetail Validator tab', () => {
    it('shows the roster row that names this key and this address as label and value rows', async () => {
        mount([
            { source: OTHER, signing_pubkey: KEY, uptime: '99%', status: 'valid' },
            { source: ADDRESS, signing_pubkey: KEY.toUpperCase(), uptime: '41%', score: 77, votes: 1200, missed: 3, last_seen_block: 198, status: 'valid' },
        ]);

        fireEvent.click(await screen.findByRole('tab', { name: 'Validator' }));
        const list = screen.getByRole('list', { name: 'Validator performance' });
        expect(valueOf(list, 'Status')).toHaveTextContent('Active');
        expect(valueOf(list, 'Uptime')).toHaveTextContent('41%');
        expect(valueOf(list, 'Score')).toHaveTextContent('77');
        expect(valueOf(list, 'Votes recorded')).toHaveTextContent('1200');
        expect(valueOf(list, 'Missed')).toHaveTextContent('3');
        expect(valueOf(list, 'Last seen block')).toHaveTextContent('198');
        // G99: the key is the fitting AddressText (whole when the row has room),
        // named by the full key; jsdom has no layout, so it shows its short form.
        const key = within(valueOf(list, 'Signing key')).getByLabelText(KEY);
        expect(key).toHaveAttribute('title', KEY);
        expect(key.textContent).not.toBe(KEY);
        expect(list.textContent).not.toMatch(/99%/);
    });

    it('has no Validator tab when the roster row with this key belongs to another address', async () => {
        mount([{ source: OTHER, signing_pubkey: KEY, uptime: '99%', score: 77, status: 'valid' }]);

        expect(await screen.findByRole('tab', { name: 'Actions' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Validator' })).toBeNull();
        const views = screen.getByRole('tablist', { name: 'Stake detail view' });
        expect(within(views).getAllByRole('tab')).toHaveLength(3);
    });

    it('has no Validator tab without a delegated key', async () => {
        mount([{ source: ADDRESS, signing_pubkey: KEY, uptime: '41%' }], { delegations: [] });

        expect(await screen.findByRole('tab', { name: 'Actions' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Validator' })).toBeNull();
    });

    it('says the validator is not active yet when its row has no figures', async () => {
        mount([{ source: ADDRESS, signing_pubkey: KEY, status: 'pending' }]);

        fireEvent.click(await screen.findByRole('tab', { name: 'Validator' }));
        expect(screen.getByText('Validator not active yet')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Validator performance' })).toBeNull();
    });

    it('offers no Operator View tile and no operator-dashboard route', async () => {
        mount([]);

        const list = await screen.findByRole('list', { name: 'Stake actions' });
        expect(within(list).getAllByRole('button').length).toBeGreaterThan(0);
        expect(within(list).queryByRole('button', { name: /operator/i })).toBeNull();
        const routes = Object.keys(ROUTE_REGISTRY);
        expect(routes).toContain('stake-detail');
        expect(routes).not.toContain('operator-dashboard');
    });
});

describe('ownValidatorRow', () => {
    it('matches the key case-insensitively and the address exactly', () => {
        const mine = { source: ADDRESS, signing_pubkey: KEY.toUpperCase() };
        expect(ownValidatorRow({ validators: [{ source: OTHER, signing_pubkey: KEY }, mine], signingPubkey: KEY, address: ADDRESS })).toBe(mine);
        expect(ownValidatorRow({ validators: [{ source: OTHER, signing_pubkey: KEY }], signingPubkey: KEY, address: ADDRESS })).toBeNull();
        expect(ownValidatorRow({ validators: [mine], signingPubkey: '', address: ADDRESS })).toBeNull();
        expect(ownValidatorRow({ validators: null, signingPubkey: KEY, address: ADDRESS })).toBeNull();
    });
});
