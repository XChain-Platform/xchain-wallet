// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('../../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ onSelect, initialTab }) => (
        <div data-initial-tab={initialTab || ''}>
            <button
                type="button"
                onClick={() => onSelect({
                    actionIndex: '303',
                    type: '2',
                    memberCount: 4,
                    name: 'Picker policy',
                })}
            >
                Pick named list
            </button>
            {/* A published list from the All view, as the real picker sends it. */}
            <button
                type="button"
                onClick={() => onSelect({
                    actionIndex: '204',
                    type: '2',
                    memberCount: 3,
                    homeChain: 'LTC',
                    homeListIndex: '9',
                    shared: true,
                })}
            >
                Pick shared list
            </button>
        </div>
    ),
}));

const MAINNET = 'bitcoin-mainnet';
const REGTEST = 'bitcoin-regtest';
const TICK = 'POLICY';
const TOKEN_ADMIN_FORM_SOURCE = readFileSync(
    resolve('packages/core/src/shared/routes/TokenAdminForm.jsx'),
    'utf8',
);

// The field's clear action: its onClear handler, then its clearLabel.
function removeHandlerBody(label) {
    const match = TOKEN_ADMIN_FORM_SOURCE.match(new RegExp(
        `\\(\\) => \\{([^}]*)\\}\\s*:\\s*undefined\\}\\s*clearLabel="${label}"`,
    ));
    expect(match).not.toBeNull();
    return match[1];
}

function sourceFor(chainId) {
    return {
        id: 'addr-1',
        address: chainId === REGTEST
            ? 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt'
            : 'bc1qissuer',
        publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    };
}

function proxyMessaging(target) {
    return new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (obj, prop) => prop in obj,
    });
}

function mountAdmin({
    chainId = MAINNET,
    tokenInfo = { allowList: null, blockList: null },
    listDetails = {},
    getListByActionIndex,
    initialPicker,
    sharedLists = [],
} = {}) {
    const source = sourceFor(chainId);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [source] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: source.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: source.address, ...tokenInfo }),
        getListByActionIndex: getListByActionIndex || vi.fn(async ({ actionIndex }) => (
            listDetails[String(actionIndex)] || { members: [] }
        )),
        getSharedLists: vi.fn().mockResolvedValue({ lists: sharedLists, unavailable: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };
    const messaging = proxyMessaging(target);
    const rendered = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="access-lists"
                initialChainId={chainId}
                initialTick={TICK}
                initialFromAddress={source.address}
                initialPicker={initialPicker}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { ...rendered, messaging };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm list names', () => {
    it('shows names from prefilled allow-list and block-list detail reads', async () => {
        mountAdmin({
            tokenInfo: { allowList: '12', blockList: '34' },
            listDetails: {
                12: { name: 'Trusted senders', members: ['a'] },
                34: { name: 'Denied senders', members: ['a', 'b'] },
            },
        });

        expect(await screen.findByText('Trusted senders (List #12) · 1 member')).toBeTruthy();
        expect(await screen.findByText('Denied senders (List #34) · 2 members')).toBeTruthy();
    });

    it('keeps the index-only labels for missing and empty names', async () => {
        mountAdmin({
            tokenInfo: { allowList: '21', blockList: '22' },
            listDetails: {
                21: { members: [] },
                22: { name: '', members: [] },
            },
        });

        expect(await screen.findByText('List #21 · 0 members')).toBeTruthy();
        expect(await screen.findByText('List #22 · 0 members')).toBeTruthy();
    });

    it('uses a picker name immediately and clears it when the list is removed', async () => {
        const pendingDetail = new Promise(() => {});
        mountAdmin({
            chainId: REGTEST,
            getListByActionIndex: vi.fn().mockReturnValue(pendingDetail),
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Allow list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named list' }));

        expect(screen.getByText('Picker policy (List #303) · 4 members')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Remove allow-list' }));
        expect(screen.getByText('None after this update')).toBeTruthy();
        expect(screen.queryByText(/Picker policy/)).toBeNull();
    });

    it('clears cached names directly in both Remove handlers', () => {
        expect(removeHandlerBody('Remove allow-list')).toContain('setAllowListName(null)');
        expect(removeHandlerBody('Remove block-list')).toContain('setBlockListName(null)');
    });

    it('keeps a shared block-list label ahead of the bound list name', async () => {
        mountAdmin({
            initialPicker: 'shared-block',
            listDetails: {
                204: { name: 'Bound target metadata', members: ['a', 'b', 'c'] },
            },
            sharedLists: [{
                home_chain: 'LTC',
                home_list_index: 9,
                type: 2,
                owner: 'ltc1owner',
                member_count: 3,
                share_block: 100,
                bind_target: 204,
            }],
        });

        // Manage token's Shared block list entry opens the picker on All.
        const pick = await screen.findByRole('button', { name: 'Pick shared list' });
        expect(pick.parentElement).toHaveAttribute('data-initial-tab', 'all');
        fireEvent.click(pick);

        expect(await screen.findByText('List #204 (shared from LTC list #9) · 3 members')).toBeTruthy();
        expect(screen.queryByText(/Bound target metadata/)).toBeNull();
    });

    it('labels a published allow list the same way', async () => {
        mountAdmin({
            listDetails: { 204: { name: 'Bound target metadata', members: ['a', 'b', 'c'] } },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Allow list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick shared list' }));
        expect(await screen.findByRole('button', {
            name: 'Allow list: List #204 (shared from LTC list #9) · 3 members',
        })).toBeTruthy();
    });
});
