// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The oracle console audit. The operator half went with the retired Operator
// Dashboard; validator figures now live in Stake detail's Validator tab
// (StakeDetail.validatorTab.test.jsx).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
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

describe('oracle dashboard audit', () => {
    it('uses plain market labels and keeps the last market after a failed refresh', async () => {
        const { messaging, betFeeds } = oracleMessaging([{
            action_index: '42', source: ADDRESS.address, label: 'Rain tomorrow',
            outcomes: 'Yes,No', feed_status: 'open',
            deadline: 2_000_000_000, expire_at: 2_000_003_600,
        }]);
        const { container } = mount(OracleConsole, messaging);

        expect(await screen.findByText(/Market number: #42; Rain tomorrow/)).toBeTruthy();
        expect(screen.getByText('Market status: Positions available')).toBeTruthy();
        expect(container.textContent).not.toContain('Market status: open');

        fireEvent.click(screen.getByRole('button', { name: 'Refresh Markets' }));
        await waitFor(() => expect(betFeeds).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('Could not refresh your markets. The last known markets are still shown.')).toBeTruthy();
        expect(screen.getByText(/Market number: #42; Rain tomorrow/)).toBeTruthy();
    });

    it('distinguishes empty and failed initial market reads and offers refresh in both states', async () => {
        const empty = oracleMessaging([]);
        const emptyView = mount(OracleConsole, empty.messaging);
        expect(await screen.findByText('No markets yet')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Refresh Markets' })).toBeTruthy();
        emptyView.unmount();

        const failed = oracleMessaging([]);
        failed.messaging.betFeeds = vi.fn().mockRejectedValue(new Error('offline'));
        mount(OracleConsole, failed.messaging);
        expect(await screen.findByText('Could not load your markets. Check your connection and try again.')).toBeTruthy();
        expect(screen.queryByText('No markets yet')).toBeNull();
        expect(screen.getByRole('button', { name: 'Refresh Markets' })).toBeTruthy();
    });

    it('gives the console narrow-screen wrapping and card sizing rules', () => {
        const oracleCss = readFileSync('packages/core/src/shared/routes/OracleConsole.module.css', 'utf8');

        expect(oracleCss).toMatch(/flex-wrap:\s*wrap/);
        expect(oracleCss).toMatch(/@media \(max-width: 480px\)/);
        // The actions are one ActionList per market (G101), whose rows wrap
        // their own text, stacked under the market's card.
        expect(oracleCss).toMatch(/\.market\s*\{[^}]*flex-direction:\s*column/);
        expect(oracleCss).not.toMatch(/\.actionRow/);
    });
});
