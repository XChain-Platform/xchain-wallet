// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const OWNER = 'bcrt1qownerownerownerownerownerowner000';
const OTHER = 'bcrt1qotherotherotherotherotherother000';

beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount({ mine = OWNER, tokenInfo = {}, handlers = {}, messagingOverrides = {} } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: OWNER,
            displayName: 'Approved token',
            description: 'A useful token for its community.',
            totalSupply: '1250000000',
            maxSupply: '5000000000',
            divisibility: 8,
            callbackTick: 'CALLBACK',
            locks: {},
            ...tokenInfo,
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: mine }] }),
        getGenesisForToken: vi.fn().mockResolvedValue({
            source: OWNER,
            block_index: 12345,
            action_index: '12345.1',
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken
                walletId="wallet"
                chainId={CHAIN}
                tick="APPROVED"
                onBack={() => {}}
                {...handlers}
            />
        </MessagingProvider>,
    );
    return messaging;
}

function actionGrid() {
    return screen.getByRole('tabpanel').firstElementChild;
}

describe('ManageToken approved design', () => {
    it('shows only the identity content in the blue box and requests no removed panel data', async () => {
        const messaging = mount();
        const hero = await screen.findByRole('region', { name: 'Token identity' });

        expect(within(hero).getByRole('heading', { name: 'Approved token' })).toBeInTheDocument();
        expect(within(hero).getByText('A useful token for its community.')).toBeInTheDocument();
        expect(within(hero).getByRole('img', { name: /APPROVED on/i })).toBeInTheDocument();
        expect(within(hero).queryByText(/Owned by|Supply|Holders|You hold/i)).toBeNull();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Actions', 'Details']);

        expect(messaging.getHoldersForToken).not.toHaveBeenCalled();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(messaging.getDispensersForToken).not.toHaveBeenCalled();
        expect(messaging.getOrdersForToken).not.toHaveBeenCalled();
        expect(messaging.getSwapsForToken).not.toHaveBeenCalled();
        expect(messaging.getHistoryForToken).not.toHaveBeenCalled();
    });

    it('keeps non-owner actions visible and disabled without an owner warning', async () => {
        mount({
            mine: OTHER,
            handlers: { onMint: vi.fn(), onIssueSubtoken: vi.fn(), onDestroy: vi.fn() },
        });
        await screen.findByRole('region', { name: 'Token identity' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Mint' })).toBeDisabled());

        expect(screen.queryByText(/doesn.t hold the token.s issuer address/i)).toBeNull();
        expect(screen.queryByText(/^Owned by$/i)).toBeNull();
        expect(screen.getByRole('button', { name: 'Issue subtoken' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Destroy' })).toBeEnabled();
    });

    it('starts with the required action order, includes every tile, and invokes Issue subtoken', async () => {
        const onIssueSubtoken = vi.fn();
        const onUseSharedBlockList = vi.fn();
        const onUnbindController = vi.fn();
        mount({ handlers: { onIssueSubtoken, onUseSharedBlockList, onUnbindController } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Issue subtoken' })).toBeEnabled());

        // The tiles sit in collapsible groups, Supply open and the rest closed.
        const toggles = [...screen.getByRole('tabpanel').querySelectorAll('button[aria-expanded]')];
        expect(toggles.map((toggle) => toggle.textContent.replace(/(Supply|Distribute|Token page|Ownership|Rules and automation).*/, '$1')))
            .toEqual(['Supply', 'Distribute', 'Token page', 'Ownership', 'Rules and automation']);
        expect(toggles.map((toggle) => toggle.getAttribute('aria-expanded')))
            .toEqual(['true', 'false', 'false', 'false', 'false']);
        // Every tile is in the page, group by group, whether or not its group is open.
        const labels = [...screen.getByRole('tabpanel').querySelectorAll('button:not([aria-expanded])')]
            .map((button) => button.textContent);
        expect(labels).toEqual([
            'Destroy', 'Issue subtoken', 'Lock settings', 'Mint', 'Mint settings',
            'Airdrop', 'Broadcast', 'Dispenser', 'Dividend',
            'Artwork', 'Description', 'Gated content', 'Official list',
            'Controller', 'Sell name', 'Transfer', 'Unbind controller',
            'Access lists', 'Bridge', 'Callback settings', 'Execute callback', 'Pause token', 'Shared block list',
        ]);
        fireEvent.click(screen.getByRole('button', { name: 'Issue subtoken' }));
        fireEvent.click(toggles[4]);
        fireEvent.click(screen.getByRole('button', { name: 'Shared block list' }));
        expect(onIssueSubtoken).toHaveBeenCalledTimes(1);
        expect(onUseSharedBlockList).toHaveBeenCalledTimes(1);
        // Unbind is its own form, offered in Ownership beside Controller.
        fireEvent.click(toggles[3]);
        fireEvent.click(screen.getByRole('button', { name: 'Unbind controller' }));
        expect(onUnbindController).toHaveBeenCalledTimes(1);
    });

    it('shows every detail, all eight lock states, and a copyable owner', async () => {
        mount({ tokenInfo: {
            locks: {
                max_supply: true,
                max_mint: false,
                mint: true,
                mint_supply: false,
                description: true,
                sleep: false,
                callback: true,
            },
            lockBridge: false,
        } });
        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        const card = screen.getByRole('region', { name: 'Token details' });

        expect(within(card).getByText('APPROVED')).toBeInTheDocument();
        expect(within(card).getByText('Yes, 8 places')).toBeInTheDocument();
        expect(within(card).getByText('Block 12,345')).toBeInTheDocument();
        // The owner's Copy is an icon-only button beside the address.
        expect(within(card).getByRole('button', { name: 'Copy owner address' }).textContent.trim()).toBe('');
        expect(within(card).getByRole('button', { name: 'Copy owner address' }).querySelector('svg')).not.toBeNull();
        expect(within(card).getAllByLabelText(/: (Locked|Editable)$/)).toHaveLength(8);
        expect(within(card).getByLabelText('Max supply: Locked').querySelector('svg')).not.toBeNull();
        expect(within(card).getByLabelText('Bridge settings: Editable').querySelector('svg')).not.toBeNull();

        fireEvent.click(within(card).getByRole('button', { name: 'Copy owner address' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(OWNER));
    });

    it('falls back from Shared block list to the access-list handler', async () => {
        const onAccessLists = vi.fn();
        mount({ handlers: { onAccessLists } });
        // The tile is in the Rules and automation group, closed until opened.
        fireEvent.click(await screen.findByRole('button', { name: /^Rules and automation/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Shared block list' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Shared block list' }));
        expect(onAccessLists).toHaveBeenCalledTimes(1);
    });

    it('wires Issue subtoken into the existing wizard in every shell', () => {
        for (const file of [
            'packages/web/src/App.jsx',
            'packages/desktop/renderer/App.jsx',
            'packages/extension/src/popup/App.jsx',
        ]) {
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            expect(source).toContain("onIssueSubtoken={() => openForm('wizard')}");
        }
    });
});
