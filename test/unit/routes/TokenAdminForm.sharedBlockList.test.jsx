// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListPickerScreen } from '../../../packages/core/src/shared/components/ListPickerScreen.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const TICK = 'POLICY';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qissuer',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function proxyMessaging(target) {
    return new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (obj, prop) => prop in obj,
    });
}

function mountAdmin({ initialPicker } = {}) {
    const composeForConfirm = vi.fn().mockRejectedValue(new Error('stop after capture'));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: SOURCE.address, allowList: null, blockList: null }),
        getSharedLists: vi.fn().mockResolvedValue({
            lists: [{
                home_chain: 'LTC',
                home_list_index: 9,
                type: 2,
                owner: 'ltc1owner',
                member_count: 3,
                share_block: 100,
                bind_target: 204,
            }],
            unavailable: [],
        }),
        getListByActionIndex: vi.fn().mockResolvedValue({ members: ['a', 'b', 'c'] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        composeForConfirm,
    };
    const messaging = proxyMessaging(target);
    const rendered = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="access-lists"
                initialChainId={CHAIN}
                initialTick={TICK}
                initialFromAddress={SOURCE.address}
                initialPicker={initialPicker}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { ...rendered, messaging, composeForConfirm };
}

async function mountManage(onAccessLists) {
    const messaging = proxyMessaging({
        getTokenInfo: vi.fn().mockResolvedValue({ creator: SOURCE.address, description: 'Shared list token' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken
                walletId="w"
                chainId={CHAIN}
                tick={TICK}
                onBack={() => {}}
                onMint={() => {}}
                onCreateDispenser={() => {}}
                onAirdrop={() => {}}
                onDestroy={() => {}}
                onAccessLists={onAccessLists}
            />
        </MessagingProvider>,
    );
    await screen.findByText('Shared list token');
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm shared block lists', () => {
    it('opens the directory, binds its local target, and composes ISSUE v5', async () => {
        const { composeForConfirm, messaging } = mountAdmin();

        fireEvent.click(await screen.findByRole('button', { name: 'Use a shared block list' }));
        const choose = await screen.findByRole('button', { name: 'Choose list' });
        expect(messaging.getSharedLists).toHaveBeenCalledWith({ chainId: CHAIN });
        fireEvent.click(choose);

        expect(await screen.findByText(/List #204 \(shared from LTC list #9\)/)).toBeTruthy();
        expect(screen.getByText(/3 members/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Update token' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
        expect(composeForConfirm.mock.calls[0][0].actionData).toEqual({
            action: 'ISSUE',
            params: { VERSION: '5', TICK, BLOCK_LIST: '204' },
        });
    });

    it('opens the shared directory from initialPicker', async () => {
        mountAdmin({ initialPicker: 'shared-block' });

        expect(await screen.findByText('Choose a shared list')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Choose list' })).toBeTruthy();
    });
});

describe('shared block list entry points', () => {
    it('falls back to ManageToken onAccessLists', async () => {
        const onAccessLists = vi.fn();
        await mountManage(onAccessLists);

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Use a shared block list' }));

        expect(onAccessLists).toHaveBeenCalledTimes(1);
    });

    it('keeps unions hidden by default and includes matching unions on request', async () => {
        const messaging = {
            getListsForSource: vi.fn().mockResolvedValue([
                { action_index: '10', type: '2', block_index: 2 },
                { action_index: '20', type: '3', block_index: 1 },
            ]),
            getListByActionIndex: vi.fn(async ({ actionIndex }) => ({
                10: { type: '2', list: ['a'] },
                20: { type: '3', list: ['11'] },
                11: { type: '2', list: ['b'] },
            }[actionIndex])),
        };
        const props = {
            variant: 'full',
            messaging,
            chainId: CHAIN,
            addresses: [SOURCE],
            filterType: '2',
            onSelect: () => {},
            onBack: () => {},
        };
        const first = render(<ListPickerScreen {...props} />);

        await screen.findByText('Address list #10');
        expect(screen.queryByText('Union list #20')).toBeNull();
        first.unmount();
        render(<ListPickerScreen {...props} includeUnions />);

        expect(await screen.findByText('Union list #20')).toBeTruthy();
    });
});
