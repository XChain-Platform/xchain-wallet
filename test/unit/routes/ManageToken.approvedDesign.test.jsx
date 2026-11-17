// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The manage-token route keeps the shared Actions, Details and History page,
// but begins with a plain identity card instead of browse-only balance data.

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

// The wallet holds 1 APPROVED, so the issuer's spending actions (Destroy,
// Dispenser, Airdrop) are open; with none held they lock (AssetDetail.followups).
function mount({ mine = OWNER, tokenInfo = {}, handlers = {}, messagingOverrides = {}, quantity = '100000000' } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: OWNER,
            name: 'Approved token',
            description: 'A useful token for its community.',
            totalSupply: '1250000000',
            maxSupply: '5000000000',
            divisibility: 8,
            callbackTick: 'CALLBACK',
            locks: {},
            ...tokenInfo,
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: mine }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
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
                quantity={quantity}
                onBack={() => {}}
                {...handlers}
            />
        </MessagingProvider>,
    );
    return messaging;
}

/** One action row by its id. */
function actionRow(id) {
    return document.querySelector(`[data-action-id="${id}"]`);
}

function pageTabs() {
    return within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab');
}

describe('ManageToken is the one asset page', () => {
    it('opens with only the token identity card before the three page tabs', async () => {
        const messaging = mount();
        const identity = await screen.findByRole('region', { name: 'Token identity' });
        expect(within(identity).getByRole('img', { name: /APPROVED on Bitcoin/i })).toBeInTheDocument();
        expect(within(identity).getByRole('heading', { name: 'APPROVED' })).toBeInTheDocument();
        expect(within(identity).getByText('Approved token')).toBeInTheDocument();
        expect(within(identity).queryByText('A useful token for its community.')).toBeNull();
        expect(identity.closest('[class*="heroStack"]')).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Chart range' })).toBeNull();
        expect(screen.queryByRole('region', { name: /chart/i })).toBeNull();
        expect(screen.queryByRole('group', { name: /balance summary/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /balance/i })).toBeNull();
        expect(pageTabs().map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'History']);

        expect(messaging.getHoldersForToken).not.toHaveBeenCalled();
        expect(messaging.getDispensersForToken).not.toHaveBeenCalled();
        expect(messaging.getOrdersForToken).not.toHaveBeenCalled();
        expect(messaging.getSwapsForToken).not.toHaveBeenCalled();
        expect(messaging.getHistoryForToken).not.toHaveBeenCalled();
    });

    it('keeps non-owner issuer actions visible, enabled, and opening their forms', async () => {
        const onMint = vi.fn();
        const onIssueSubtoken = vi.fn();
        mount({
            mine: OTHER,
            handlers: { onMint, onIssueSubtoken, onDestroy: vi.fn() },
        });
        await screen.findByRole('region', { name: 'Token identity' });
        await waitFor(() => expect(actionRow('mint')).not.toHaveAttribute('aria-disabled'));

        expect(actionRow('issue-subtoken')).not.toHaveAttribute('aria-disabled');
        expect(actionRow('issue-subtoken')).toHaveTextContent('Create a new token under this one');
        fireEvent.click(actionRow('mint'));
        fireEvent.click(actionRow('issue-subtoken'));
        expect(onMint).toHaveBeenCalledWith({ issuer: OWNER });
        expect(onIssueSubtoken).toHaveBeenCalledWith({ issuer: OWNER });
        expect(actionRow('destroy')).not.toHaveAttribute('aria-disabled');
    });

    it('opens on Actions: the holder list, then the five issuer groups as headed lists in order', async () => {
        const onIssueSubtoken = vi.fn();
        const onUseSharedBlockList = vi.fn();
        const onUnbindController = vi.fn();
        mount({ handlers: { onIssueSubtoken, onUseSharedBlockList, onUnbindController } });
        await waitFor(() => expect(actionRow('issue-subtoken')).not.toHaveAttribute('aria-disabled'));

        const tabs = pageTabs();
        expect(tabs[0].textContent).toBe('Actions');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');

        // No collapsible groups on an info page: every group is a heading
        // over one action list (G101), all of them open.
        const groups = [...document.querySelectorAll('[data-owner-group]')];
        expect(groups.map((group) => group.getAttribute('aria-label')))
            .toEqual(['Supply', 'Distribute', 'Token page', 'Ownership', 'Rules and automation']);
        expect(document.querySelectorAll('[data-owner-group] button[aria-expanded]')).toHaveLength(0);
        const ids = groups.flatMap((group) => [...group.querySelectorAll('[data-action-id]')]
            .map((row) => row.getAttribute('data-action-id')));
        expect(ids).toEqual([
            'destroy', 'issue-subtoken', 'lock-settings', 'mint', 'mint-settings',
            'airdrop', 'broadcast', 'dispenser', 'dividend',
            'artwork', 'description', 'gated-content', 'official-list',
            'controller', 'sell-name', 'transfer', 'controller-unbind',
            'access-lists', 'bridge', 'callback-settings', 'pause-token', 'execute-callback', 'shared-block-list',
        ]);
        expect(screen.getByRole('button', { name: /^Issue subtoken\b/ }).textContent)
            .toBe('Issue subtokenCreate a new token under this one');
        fireEvent.click(screen.getByRole('button', { name: /^Issue subtoken\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Shared block list\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Unbind controller\b/ }));
        expect(onIssueSubtoken).toHaveBeenCalledTimes(1);
        // Each handler gets the issuer the page resolved.
        expect(onIssueSubtoken).toHaveBeenCalledWith({ issuer: OWNER });
        expect(onUseSharedBlockList).toHaveBeenCalledTimes(1);
        expect(onUnbindController).toHaveBeenCalledTimes(1);
    });

    it('runs each row\'s own handler', async () => {
        const HANDLER_BY_ID = {
            destroy: 'onDestroy',
            'issue-subtoken': 'onIssueSubtoken',
            'lock-settings': 'onLock',
            mint: 'onMint',
            'mint-settings': 'onMintSettings',
            airdrop: 'onAirdrop',
            broadcast: 'onBroadcast',
            dispenser: 'onCreateDispenser',
            dividend: 'onPayDividend',
            artwork: 'onAttachContent',
            description: 'onUpdateDescription',
            'gated-content': 'onGatedContent',
            'official-list': 'onManageRoster',
            controller: 'onBindController',
            'controller-unbind': 'onUnbindController',
            'sell-name': 'onSellOwnership',
            transfer: 'onTransferOwnership',
            'access-lists': 'onAccessLists',
            bridge: 'onBridgeSettings',
            'callback-settings': 'onCallbackSettings',
            'execute-callback': 'onExecuteCallback',
            'pause-token': 'onPauseToken',
            'shared-block-list': 'onUseSharedBlockList',
        };
        const handlers = Object.fromEntries(Object.values(HANDLER_BY_ID).map((name) => [name, vi.fn()]));
        mount({ handlers });
        await waitFor(() => expect(actionRow('issue-subtoken')).not.toHaveAttribute('aria-disabled'));
        for (const [id, name] of Object.entries(HANDLER_BY_ID)) {
            const row = actionRow(id);
            expect(row, id).not.toHaveAttribute('aria-disabled');
            fireEvent.click(row);
            expect(handlers[name], `${id} runs ${name}`).toHaveBeenCalledTimes(1);
        }
    });

    it('draws Destroy as a danger row that still runs its handler', async () => {
        const onDestroy = vi.fn();
        mount({ handlers: { onDestroy } });
        const destroy = await screen.findByRole('button', { name: /^Destroy\b/ });
        expect(destroy.getAttribute('data-tone')).toBe('danger');
        await waitFor(() => expect(actionRow('mint')).not.toBeNull());
        expect(actionRow('mint').getAttribute('data-tone')).toBe('default');
        fireEvent.click(destroy);
        expect(onDestroy).toHaveBeenCalledTimes(1);
    });

    it('shows the issuer facts and all eight lock states in the one Details card', async () => {
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
        await waitFor(() => expect(within(card).getByText('Block 12,345')).toBeInTheDocument());
        // Name and Ticker rows both read the tick.
        expect(within(card).getAllByText('APPROVED').length).toBeGreaterThan(0);
        expect(within(card).getByText('Supply cap')).toBeInTheDocument();
        // The creator copies from its own icon button.
        expect(within(card).getByRole('button', { name: 'Copy creator address' })).toBeInTheDocument();
        expect(within(card).getAllByLabelText(/: (Locked|Editable)$/)).toHaveLength(8);
        expect(within(card).getByLabelText('Max supply: Locked').querySelector('svg')).not.toBeNull();
        expect(within(card).getByLabelText('Bridge settings: Editable').querySelector('svg')).not.toBeNull();
        // One card: the issuer rows sit in the same list as the token's facts.
        expect(card.querySelectorAll('ul[aria-label="Token detail fields"]')).toHaveLength(1);
        expect(card.querySelector('[data-detail-id="lock-max_supply"]').closest('ul'))
            .toBe(card.querySelector('ul[aria-label="Token detail fields"]'));
    });

    it('falls back from Shared block list to the access-list handler', async () => {
        const onAccessLists = vi.fn();
        mount({ handlers: { onAccessLists } });
        await waitFor(() => expect(screen.getByRole('button', { name: /^Shared block list\b/ })).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(screen.getByRole('button', { name: /^Shared block list\b/ }));
        expect(onAccessLists).toHaveBeenCalledTimes(1);
    });

    it('wires Issue subtoken into the existing wizard in every shell, on the shared page', () => {
        for (const file of [
            'packages/web/src/App.jsx',
            'packages/desktop/renderer/App.jsx',
            'packages/extension/src/popup/App.jsx',
        ]) {
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            expect(source).toContain("onIssueSubtoken: (ctx) => openOwnerForm('wizard', ctx)");
            expect(source).not.toContain('<ManageToken');
        }
    });

    it('draws each issuer group as a heading over one edge-to-edge action list', async () => {
        mount();
        await waitFor(() => expect(document.querySelector('[data-owner-group="supply"]')).not.toBeNull());
        const group = document.querySelector('[data-owner-group="supply"]');
        const list = group.querySelector('ul[role="list"]');
        expect(list).not.toBeNull();
        expect(list.getAttribute('aria-label')).toBe('Supply');
        expect(within(group).getByRole('heading', { name: 'Supply' })).toBeInTheDocument();
    });
});
