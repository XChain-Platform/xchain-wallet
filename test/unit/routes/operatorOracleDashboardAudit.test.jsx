// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qoperatoroperatoroperatoroperatoroperator',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function proxy(target) {
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function operatorMessaging() {
    const getStakesForAddress = vi.fn()
        .mockResolvedValueOnce([{ amount: '12.5', activation_block: 100, status: 'valid' }])
        .mockRejectedValueOnce(new Error('Indexer unavailable'));
    return proxy({
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress,
        getDelegationsForAddress: vi.fn().mockResolvedValue([{
            signing_pubkey: '02abcdefabcdefabcdefabcdefabcdef', block_index: 105, status: 'valid',
        }]),
        getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '3', block_index: 106, status: 'valid' }]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([{ amount: '1', status: 'valid' }]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue({ data: [{
            action_format: 2, block_index: 107, message: 'BTC/USD', value: '42000', status: 'valid',
        }] }),
        getValidatorsForChain: vi.fn().mockResolvedValue([{
            signing_pubkey: '02abcdefabcdefabcdefabcdefabcdef', score: 98, votes: 22, missed: 1,
        }]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 200 }),
    });
}

function oracleMessaging(feeds) {
    const betFeeds = vi.fn()
        .mockResolvedValueOnce({ data: feeds })
        .mockRejectedValueOnce(new Error('Explorer unavailable'));
    return {
        messaging: proxy({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            betFeeds,
        }),
        betFeeds,
    };
}

function mount(Component, messaging, props) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, { walletId: 'wallet-1', onBack() {}, ...props }),
    ));
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('operator and oracle dashboard audit', () => {
    it('labels operator metrics and preserves the last values when refresh fails', async () => {
        const messaging = operatorMessaging();
        mount(OperatorDashboard, messaging, { chainId: CHAIN, address: ADDRESS.address });

        expect(await screen.findByText('Total amount staked: 12.5 XCP')).toBeTruthy();
        expect(screen.getByText(/Validator score: 98/)).toBeTruthy();
        expect(screen.getByText(/Votes recorded: 22/)).toBeTruthy();
        expect(screen.getByText(/Missed validations: 1/)).toBeTruthy();
        expect(screen.getByText('Unclaimed rewards:').closest('p'))
            .toHaveTextContent('Unclaimed rewards: 2 XCP; Total rewards earned: 3 XCP');
        expect(screen.getByText(/Format version: 2/)).toHaveTextContent('published value: 42000; published at block: 107');

        fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }));
        expect(await screen.findByText(/Couldn't refresh this section: Indexer unavailable/)).toBeTruthy();
        expect(screen.getByText('Total amount staked: 12.5 XCP')).toBeTruthy();
    });

    it('uses plain market labels and keeps the last market after a failed refresh', async () => {
        const { messaging, betFeeds } = oracleMessaging([{
            action_index: '42', source: ADDRESS.address, label: 'Rain tomorrow',
            outcomes: 'Yes,No', feed_status: 'open',
            deadline: 2_000_000_000, expire_at: 2_000_003_600,
        }]);
        const { container } = mount(OracleConsole, messaging);

        expect(await screen.findByText(/Market number: #42; Rain tomorrow/)).toBeTruthy();
        expect(screen.getByText('Market status: Taking bets')).toBeTruthy();
        expect(container.textContent).not.toContain('Market status: open');

        fireEvent.click(screen.getByRole('button', { name: 'Refresh markets' }));
        await waitFor(() => expect(betFeeds).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('Could not refresh your markets. The last known markets are still shown.')).toBeTruthy();
        expect(screen.getByText(/Market number: #42; Rain tomorrow/)).toBeTruthy();
    });

    it('distinguishes empty and failed initial market reads and offers refresh in both states', async () => {
        const empty = oracleMessaging([]);
        const emptyView = mount(OracleConsole, empty.messaging);
        expect(await screen.findByText('No markets yet')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh markets' })).toBeTruthy();
        emptyView.unmount();

        const failed = oracleMessaging([]);
        failed.messaging.betFeeds = vi.fn().mockRejectedValue(new Error('offline'));
        mount(OracleConsole, failed.messaging);
        expect(await screen.findByText('Could not load your markets. Check your connection and try again.')).toBeTruthy();
        expect(screen.queryByText('No markets yet')).toBeNull();
        expect(screen.getByRole('button', { name: 'Refresh markets' })).toBeTruthy();
    });

    it('gives both routes narrow-screen wrapping and card sizing rules', () => {
        const operatorCss = readFileSync('packages/core/src/shared/routes/OperatorDashboard.module.css', 'utf8');
        const oracleCss = readFileSync('packages/core/src/shared/routes/OracleConsole.module.css', 'utf8');

        expect(operatorCss).toMatch(/flex-wrap:\s*wrap/);
        expect(operatorCss).toMatch(/overflow-wrap:\s*anywhere/);
        expect(operatorCss).toMatch(/@media \(max-width: 480px\)/);
        expect(oracleCss).toMatch(/flex-wrap:\s*wrap/);
        expect(oracleCss).toMatch(/@media \(max-width: 480px\)/);
        expect(oracleCss).toMatch(/white-space:\s*normal/);
    });

    it('lays operator metrics out in readable columns on wide screens', () => {
        const operatorCss = readFileSync('packages/core/src/shared/routes/OperatorDashboard.module.css', 'utf8');

        expect(operatorCss).toMatch(/\.dashboard\s*\{[^}]*display:\s*grid/s);
        expect(operatorCss).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(22rem,\s*100%\),\s*1fr\)\)/);
        expect(operatorCss).toMatch(/\.dashboard > :not\(section\)\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    });
});
