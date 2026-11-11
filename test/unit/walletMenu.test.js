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
    WALLET_MENU_FOOTER,
    WALLET_MENU_GROUPS,
    WALLET_TAB_BAR_IDS,
    visibleWalletMenu,
    walletMenuFooter,
    walletMenuRow,
} from '../../packages/core/src/shared/walletMenu.js';

const allRows = [...WALLET_MENU_GROUPS.flatMap((group) => group.rows), ...WALLET_MENU_FOOTER];

describe('wallet menu catalogue', () => {
    it('holds the four groups in reading order', () => {
        expect(WALLET_MENU_GROUPS.map((group) => group.id)).toEqual(['wallet', 'trade', 'manage', 'people']);
    });

    it('gives every row a unique id, an icon export and an English label', () => {
        const ids = allRows.map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const row of allRows) {
            expect(typeof Icon[row.icon], `${row.id} icon ${row.icon}`).toBe('function');
        }
        const labels = visibleWalletMenu({ hasVmAddress: true, hasBtcAddress: true })
            .flatMap((group) => group.rows.map((row) => row.label));
        for (const label of [...labels, ...walletMenuFooter().map((row) => row.label)]) {
            expect(label).not.toMatch(/^walletMenu\./);
        }
    });

    it('shows every row to a full wallet', () => {
        const rows = visibleWalletMenu({ hasVmAddress: true, hasBtcAddress: true }).flatMap((group) => group.rows);
        expect(rows).toHaveLength(WALLET_MENU_GROUPS.flatMap((group) => group.rows).length);
    });

    it('drops Send and Receive in signer mode and gated rows the wallet cannot use', () => {
        const ids = visibleWalletMenu({ isSignerMode: true, hasDexSurface: false })
            .flatMap((group) => group.rows.map((row) => row.id));
        for (const hidden of ['send', 'receive', 'markets', 'market-activity', 'contracts-list', 'staking-dashboard', 'multisig-create']) {
            expect(ids).not.toContain(hidden);
        }
        expect(ids).toContain('home');
        expect(ids).toContain('actions');
    });

    it('ends with Settings and Lock wallet', () => {
        expect(walletMenuFooter().map((row) => row.label)).toEqual(['Settings', 'Lock wallet']);
    });

    it('builds the tab bar from catalogue rows only', () => {
        expect(WALLET_TAB_BAR_IDS).toEqual(['home', 'send', 'receive', 'history', 'settings']);
        for (const id of WALLET_TAB_BAR_IDS) expect(walletMenuRow(id), id).toBeTruthy();
    });
});
