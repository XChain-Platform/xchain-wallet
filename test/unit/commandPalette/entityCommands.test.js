// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// entity search: tokens, connected sites, settings sections, help
// topics, and the txid/date "search history" free-form intent.

import { describe, it, expect, vi } from 'vitest';
import {
    balancesToCommands,
    sitesToCommands,
    settingsSectionsToCommands,
    helpToCommands,
    parseFreeformCommands,
    COMMAND_CATEGORIES,
} from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

const ROW = {
    kind: 'token',
    chainId: 'dogecoin-regtest',
    chainShort: 'DOGE',
    chainDisplayName: 'Dogecoin Regtest',
    tick: 'PEPECREATURE',
    displayName: 'Pepe Creature',
    divisibility: 8,
    fiatRate: null,
    quantity: '1000',
    imageUrl: null,
};

describe('balancesToCommands', () => {
    it('returns [] without an openToken handler or with bad input', () => {
        expect(balancesToCommands([ROW], {})).toEqual([]);
        expect(balancesToCommands(null, { openToken() {} })).toEqual([]);
    });

    it('maps rows to Tokens commands whose run hands back the full row', () => {
        const openToken = vi.fn();
        const cmds = balancesToCommands([ROW, { bogus: true }], { openToken });
        expect(cmds).toHaveLength(1);
        expect(cmds[0].category).toBe('Tokens');
        expect(COMMAND_CATEGORIES).toContain('Tokens');
        expect(cmds[0].title).toBe('Pepe Creature');
        expect(cmds[0].keywords).toContain('PEPECREATURE');
        cmds[0].run();
        expect(openToken).toHaveBeenCalledWith(ROW);
    });
});

describe('sitesToCommands', () => {
    it('returns [] without an openConnectedSites handler', () => {
        expect(sitesToCommands([{ id: '1', origin: 'https://x.example' }], {})).toEqual([]);
    });

    it('maps sites to Sites commands searchable by origin', () => {
        const openConnectedSites = vi.fn();
        const cmds = sitesToCommands(
            [{ id: 's1', appName: 'ExampleDex', origin: 'https://dex.example' }, {}],
            { openConnectedSites },
        );
        expect(cmds).toHaveLength(1);
        expect(cmds[0].category).toBe('Sites');
        expect(cmds[0].title).toBe('ExampleDex');
        expect(cmds[0].keywords).toContain('https://dex.example');
        cmds[0].run();
        expect(openConnectedSites).toHaveBeenCalled();
    });
});

describe('settingsSectionsToCommands', () => {
    it('returns [] without openSettings (popup has no Settings route)', () => {
        expect(settingsSectionsToCommands({})).toEqual([]);
    });

    it('deep-links each section by its Settings.jsx section id', () => {
        const openSettings = vi.fn();
        const cmds = settingsSectionsToCommands({ openSettings });
        expect(cmds.length).toBeGreaterThanOrEqual(10);
        const backup = cmds.find((c) => c.id === 'settings-backup');
        expect(backup.title).toBe('Settings → Backup');
        backup.run();
        expect(openSettings).toHaveBeenCalledWith('backup');
        // The keyboard section is reachable too.
        expect(cmds.some((c) => c.id === 'settings-keyboard')).toBe(true);
    });
});

describe('helpToCommands', () => {
    it('drops entries whose destination handler is missing', () => {
        expect(helpToCommands({})).toEqual([]);
        const onlyHelp = helpToCommands({ openHelp() {} });
        expect(onlyHelp).toHaveLength(1);
        expect(onlyHelp[0].id).toBe('help-keys');
    });

    it('routes topics to their settings destinations', () => {
        const openSettings = vi.fn();
        const cmds = helpToCommands({ openSettings, openHelp() {} });
        const backup = cmds.find((c) => c.id === 'help-backup');
        expect(backup.category).toBe('Help');
        backup.run();
        expect(openSettings).toHaveBeenCalledWith('backup');
    });
});

describe('parseFreeformCommands history search', () => {
    it('offers a history search for txid-shaped and date-shaped queries', () => {
        const searchHistory = vi.fn();
        for (const q of ['deadbeef01', '2026-07', '2026-07-14']) {
            const cmds = parseFreeformCommands(q, { searchHistory });
            expect(cmds.some((c) => c.id === 'freeform-history-search')).toBe(true);
            cmds.find((c) => c.id === 'freeform-history-search').run();
            expect(searchHistory).toHaveBeenCalledWith(q);
        }
    });

    it('stays quiet for ordinary fuzzy queries and without the handler', () => {
        const searchHistory = vi.fn();
        expect(parseFreeformCommands('send tokens', { searchHistory })).toEqual([]);
        expect(parseFreeformCommands('deadbeef01', {})).toEqual([]);
        // Too short to be a txid prefix (could be a tick).
        expect(parseFreeformCommands('dead', { searchHistory })).toEqual([]);
    });
});
