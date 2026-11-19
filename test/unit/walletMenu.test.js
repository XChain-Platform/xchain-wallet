// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet menu catalogue: four groups in a fixed order, every row with a
// real icon and an English label, gates that drop rows a wallet cannot use,
// and a tab bar drawn from the same rows.

import { describe, expect, it } from 'vitest';
import * as Icon from '../../packages/core/src/ui/icons/index.jsx';
import {
    WALLET_MENU_GROUPS,
    WALLET_TAB_BAR_IDS,
    visibleWalletMenu,
    walletLockAction,
    walletMenuRow,
} from '../../packages/core/src/shared/walletMenu.js';

const allRows = WALLET_MENU_GROUPS.flatMap((group) => group.rows);

describe('wallet menu catalogue', () => {
    it('holds eight groups in reading order, every box exactly seven rows', () => {
        expect(WALLET_MENU_GROUPS.map((group) => group.id)).toEqual([
            'wallet', 'assets', 'trade', 'earn', 'governance', 'people', 'wallets', 'actions',
        ]);
        // Equal boxes are the point of the layout: every box holds seven rows,
        // so boxes share one height and rows line up at any column count.
        expect(WALLET_MENU_GROUPS.map((group) => group.rows.length)).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
        const rowIds = (id) => WALLET_MENU_GROUPS.find((group) => group.id === id).rows.map((row) => row.id);
        expect(rowIds('wallet').at(-1)).toBe('settings');
        expect(rowIds('assets')).toContain('airdrop');
        expect(rowIds('governance')).toContain('governance-create-poll');
        expect(rowIds('people')).toContain('compose-message');
        expect(allRows.map((row) => row.id)).not.toContain('lock');
        const earn = WALLET_MENU_GROUPS.find((group) => group.id === 'earn');
        expect(earn.rows.map((row) => row.id)).toContain('dispenser-explorer');
        const actions = WALLET_MENU_GROUPS.find((group) => group.id === 'actions');
        expect(actions.rows[0].id).toBe('actions');
    });

    it('gives every row a unique id, an icon export and an English label', () => {
        const ids = allRows.map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const row of allRows) {
            expect(typeof Icon[row.icon], `${row.id} icon ${row.icon}`).toBe('function');
        }
        const labels = visibleWalletMenu({ hasVmAddress: true, hasBtcAddress: true })
            .flatMap((group) => group.rows.map((row) => row.label));
        for (const label of [...labels, walletLockAction().label]) {
            expect(label).not.toMatch(/^walletMenu\./);
        }
    });

    it('shows every row to a full wallet', () => {
        const rows = visibleWalletMenu({ hasVmAddress: true, hasBtcAddress: true, hasGovernanceAddress: true })
            .flatMap((group) => group.rows);
        expect(rows).toHaveLength(WALLET_MENU_GROUPS.flatMap((group) => group.rows).length);
    });

    it('drops Send and Receive in signer mode and gated rows the wallet cannot use', () => {
        const ids = visibleWalletMenu({ isSignerMode: true, hasDexSurface: false })
            .flatMap((group) => group.rows.map((row) => row.id));
        for (const hidden of [
            'send', 'receive', 'markets', 'market-activity', 'contracts-list', 'staking-dashboard', 'multisig-create',
            'governance-polls', 'governance-delegations', 'my-orders', 'swap', 'create-order', 'broadcast',
            'contract-deploy', 'batch-compose', 'advanced',
        ]) {
            expect(ids).not.toContain(hidden);
        }
        // The signing tools stay, as they do on All actions in signer mode.
        for (const shown of ['sign-message', 'verify-signature', 'sign-psbt']) expect(ids).toContain(shown);
        expect(ids).toContain('home');
        expect(ids).toContain('actions');
    });

    it('names Settings as a row and Lock wallet as a header action', () => {
        const wallet = visibleWalletMenu({}).find((group) => group.id === 'wallet');
        expect(wallet.rows.at(-1).label).toBe('Settings');
        expect(walletLockAction().label).toBe('Lock wallet');
    });

    it('labels the three new rows in Title Case and gates them like their pages', () => {
        const labels = (gates) => visibleWalletMenu(gates).flatMap((group) => group.rows.map((row) => row.label));
        const full = labels({ hasGovernanceAddress: true });
        for (const label of ['Airdrop', 'Create Poll', 'New Message']) expect(full).toContain(label);
        const signer = labels({ hasGovernanceAddress: true, isSignerMode: true });
        for (const label of ['Airdrop', 'Create Poll', 'New Message']) expect(signer).not.toContain(label);
        expect(labels({})).not.toContain('Create Poll');
    });

    it('builds the tab bar from catalogue rows only', () => {
        expect(WALLET_TAB_BAR_IDS).toEqual(['home', 'send', 'receive', 'history', 'settings']);
        for (const id of WALLET_TAB_BAR_IDS) expect(walletMenuRow(id), id).toBeTruthy();
    });
});
