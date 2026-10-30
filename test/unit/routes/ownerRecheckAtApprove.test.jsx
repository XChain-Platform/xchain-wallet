// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pause token and the token admin form (access lists among its modes) check
// the token's owner when Review composes. The confirm page then stays open,
// and its pre-flight re-check runs at Approve only once its report is 30
// seconds old. Without another read, an ownership transfer or a lock that
// lands in that window signs against the reviewed record, and the indexer
// refuses it after the fee is spent. Approve reads the record again and
// refuses when it moved.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'addr-1',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const NEW_OWNER = 'bc1q9d4ywgfnd8h43da5tpcxcn6ytpx4rstuq6u2dq';
const CHANGED = /changed since this form opened/;

function confirmMessaging(record, extra = {}) {
    const getTokenInfo = vi.fn().mockResolvedValue(record);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getTokenInfo,
        composeForConfirm: vi.fn().mockResolvedValue({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sleepState: vi.fn().mockResolvedValue({ resumeBlock: null }),
        sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'issue-txid' }),
        getListsForSource: vi.fn().mockResolvedValue([{ action_index: '42', type: '2', block_index: 1 }]),
        getListByActionIndex: vi.fn().mockResolvedValue({ type: '2', list: ['a', 'b'] }),
        ...extra,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            return prop in t ? t[prop] : vi.fn().mockResolvedValue({});
        },
    });
    return { messaging, target, getTokenInfo };
}

async function approve() {
    const button = await screen.findByRole('button', { name: 'Approve' });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => { fireEvent.click(button); });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Pause token reads the owner again at Approve', () => {
    const record = { chainId: CHAIN, tick: 'GATE', creator: OWNER.address, locks: {} };

    function mountPause(messaging) {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="w" mode="tick" initialChainId={CHAIN} initialTick="GATE" onBack={() => {}} />
            </MessagingProvider>,
        );
    }

    it('refuses when ownership moved after the confirm page opened', async () => {
        const { messaging, target, getTokenInfo } = confirmMessaging(record);
        mountPause(messaging);
        await screen.findByText('GATE is currently active (not paused).');
        fireEvent.click(screen.getByRole('radio', { name: 'Pause indefinitely' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause token' }));
        await screen.findByRole('button', { name: 'Approve' });
        getTokenInfo.mockResolvedValue({ ...record, creator: NEW_OWNER });
        await approve();
        expect(await screen.findByText(CHANGED)).toBeInTheDocument();
        expect(target.sleepAction).not.toHaveBeenCalled();
    });

    it('signs when the record did not move', async () => {
        const { messaging, target } = confirmMessaging(record);
        mountPause(messaging);
        await screen.findByText('GATE is currently active (not paused).');
        fireEvent.click(screen.getByRole('radio', { name: 'Pause indefinitely' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause token' }));
        await approve();
        await waitFor(() => expect(target.sleepAction).toHaveBeenCalledTimes(1));
    });
});

describe('Access lists reads the owner again at Approve', () => {
    const record = { chainId: CHAIN, tick: 'TOKEN', creator: OWNER.address, locks: {}, allowList: null, blockList: null };

    function mountLists(messaging) {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenAdminForm
                    walletId="w"
                    mode="access-lists"
                    initialChainId={CHAIN}
                    initialTick="TOKEN"
                    initialFromAddress={OWNER.address}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
    }

    async function bindBlockList() {
        fireEvent.click(await screen.findByRole('button', { name: /Choose block-list/ }));
        fireEvent.click(await screen.findByText(/Address list #42/));
        const update = await screen.findByRole('button', { name: 'Update token' });
        await waitFor(() => expect(update).toBeEnabled());
        fireEvent.click(update);
    }

    it('refuses when ownership moved after the confirm page opened', async () => {
        const { messaging, target, getTokenInfo } = confirmMessaging(record);
        mountLists(messaging);
        await bindBlockList();
        await screen.findByRole('button', { name: 'Approve' });
        getTokenInfo.mockResolvedValue({ ...record, creator: NEW_OWNER });
        await approve();
        expect(await screen.findByText(CHANGED)).toBeInTheDocument();
        expect(target.issueToken).not.toHaveBeenCalled();
    });

    it('refuses when a list was bound from elsewhere after the confirm page opened', async () => {
        const { messaging, target, getTokenInfo } = confirmMessaging(record);
        mountLists(messaging);
        await bindBlockList();
        await screen.findByRole('button', { name: 'Approve' });
        getTokenInfo.mockResolvedValue({ ...record, blockList: '77' });
        await approve();
        expect(await screen.findByText(CHANGED)).toBeInTheDocument();
        expect(target.issueToken).not.toHaveBeenCalled();
    });

    it('signs when the record did not move', async () => {
        const { messaging, target } = confirmMessaging(record);
        mountLists(messaging);
        await bindBlockList();
        await approve();
        await waitFor(() => expect(target.issueToken).toHaveBeenCalledTimes(1));
    });
});
