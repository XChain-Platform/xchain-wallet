// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { filterCommands } from '../../../packages/core/src/shared/commandPalette/fuzzyMatch.js';
import { navItem } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { NAV_SURFACE_DESTINATIONS } from '../../../packages/core/src/shared/routeRegistry.js';
import { t } from '../../../packages/core/src/i18n/index.js';

const SYNONYMS = {
    home: ['overview', 'balances'],
    history: ['transactions', 'activity'],
    send: ['transfer'],
    receive: ['address', 'deposit'],
    scan: ['qr', 'camera'],
    markets: ['dex', 'market', 'exchange'],
    'market-activity': ['marketplace', 'market'],
    'dispensers-list': ['vending', 'dispenser'],
    'contracts-list': ['contract', 'vm'],
    messaging: ['inbox', 'messages'],
    contacts: ['address book', 'people'],
    lists: ['list', 'allowlist'],
    obligations: ['payments due', 'coinpay', 'due'],
    settings: ['preferences', 'options'],
};

function labelFor(id) {
    if (id === 'settings') return t('home.settings');
    return navItem(id).label;
}

const ctxFor = (navigate, scan) => ({
    navigate,
    scan,
    lock() {},
    refresh() {},
    switchWallet() {},
    openHelp() {},
    hasBtcAddress: true,
    hasVmAddress: true,
    hasGovernanceAddress: true,
});

function reaches(commands, query, expectedId, navigate, scan) {
    for (const command of filterCommands(commands, query).slice(0, 3)) {
        navigate.mockClear();
        scan.mockClear();
        command.run();
        if (expectedId === 'scan' ? scan.mock.calls.length > 0 : navigate.mock.calls[0]?.[0] === expectedId) return true;
    }
    return false;
}

// The demo wallet is the narrowest catalogue; every destination must survive it.
describe('every sidebar and bottom-bar destination is findable in the command palette', () => {
    const navigate = vi.fn();
    const scan = vi.fn();
    const commands = buildCommands({ ...ctxFor(navigate, scan), isDemoWallet: true });
    const ids = [...new Set([...NAV_SURFACE_DESTINATIONS.sidebar, ...Object.values(NAV_SURFACE_DESTINATIONS).flat()])];

    it.each(ids)('%s is found by its visible label', (id) => {
        expect(reaches(commands, labelFor(id), id, navigate, scan), `${labelFor(id)} -> ${id}`).toBe(true);
    });

    it.each(Object.entries(SYNONYMS))('%s is found by its obvious synonyms', (id, words) => {
        for (const word of words) {
            expect(reaches(commands, word, id, navigate, scan), `${word} -> ${id}`).toBe(true);
        }
    });
});
