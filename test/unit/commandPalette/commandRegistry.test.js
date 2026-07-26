// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import {
    buildCommands,
    contactsToCommands,
    parseFreeformCommands,
    COMMAND_CATEGORIES,
} from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

const findById = (list, id) => list.find((c) => c.id === id);

describe('buildCommands', () => {
    it('throws when navigate is missing', () => {
        expect(() => buildCommands({})).toThrow(/navigate/);
    });

    it('every command has a unique id, a known category, a title, and a run fn', () => {
        const commands = buildCommands({ navigate() {} });
        const ids = new Set();
        for (const c of commands) {
            expect(typeof c.title).toBe('string');
            expect(c.title.length).toBeGreaterThan(0);
            expect(typeof c.run).toBe('function');
            expect(COMMAND_CATEGORIES).toContain(c.category);
            expect(ids.has(c.id)).toBe(false);
            ids.add(c.id);
        }
    });

    it('navigation command run() calls navigate with the matching view', () => {
        const navigate = vi.fn();
        const commands = buildCommands({ navigate });
        findById(commands, 'nav-send').run();
        expect(navigate).toHaveBeenCalledWith('send');
        findById(commands, 'nav-settings').run();
        expect(navigate).toHaveBeenCalledWith('settings');
        findById(commands, 'create-token').run();
        expect(navigate).toHaveBeenCalledWith('wizard');
    });

    it('gates BTC-only and governance surfaces behind the context flags', () => {
        const base = buildCommands({ navigate() {} });
        expect(findById(base, 'nav-contracts')).toBeUndefined();
        expect(findById(base, 'nav-staking')).toBeUndefined();
        expect(findById(base, 'nav-governance')).toBeUndefined();

        const gated = buildCommands({
            navigate() {},
            hasBtcAddress: true,
            hasGovernanceAddress: true,
        });
        expect(findById(gated, 'nav-contracts')).toBeDefined();
        expect(findById(gated, 'nav-staking')).toBeDefined();
        expect(findById(gated, 'nav-governance')).toBeDefined();
    });

    // The betting views shipped with no palette entry at all, so the only route
    // to them was More -> More actions -> Betting: two clicks deep in a
    // catalogue, for a surface whose whole point is coming back to check a
    // market. Every comparable destination (Governance, Staking, Dispensers, My
    // orders) has an entry, and a returning user reaches for the palette.
    it('routes the three betting views, ungated like the actions-menu entry', () => {
        const navigate = vi.fn();
        // No context flags: betting must be findable in a bare wallet, because
        // the hub itself explains when no chain here supports BET. A gate would
        // make the destination silently missing instead.
        const commands = buildCommands({ navigate });

        findById(commands, 'nav-betting').run();
        expect(navigate).toHaveBeenCalledWith('bet-markets');
        findById(commands, 'nav-my-bets').run();
        expect(navigate).toHaveBeenCalledWith('my-bets');
        findById(commands, 'nav-bet-oracle-console').run();
        expect(navigate).toHaveBeenCalledWith('bet-oracle-console');
    });

    it('finds betting by the words users actually type', () => {
        // The titles are "Betting" / "My bets" / "My markets", so a search for
        // "wager", "odds" or "oracle" only lands via keywords. Those are the
        // words a Counterparty-era user brings with them.
        const commands = buildCommands({ navigate() {} });
        const hub = findById(commands, 'nav-betting');
        for (const word of ['bet', 'wager', 'odds', 'oracle']) {
            expect(hub.keywords, `"${word}" should find the betting hub`).toContain(word);
        }
        expect(findById(commands, 'nav-bet-oracle-console').keywords).toContain('resolve');
    });

    it('omits verb commands whose handler the shell did not supply', () => {
        const bare = buildCommands({ navigate() {} });
        expect(findById(bare, 'wallet-lock')).toBeUndefined();
        expect(findById(bare, 'wallet-refresh')).toBeUndefined();
        expect(findById(bare, 'wallet-scan')).toBeUndefined();
        expect(findById(bare, 'wallet-switch')).toBeUndefined();
    });

    it('wires verb commands to the supplied handlers', () => {
        const lock = vi.fn();
        const refresh = vi.fn();
        const scan = vi.fn();
        const switchWallet = vi.fn();
        const commands = buildCommands({ navigate() {}, lock, refresh, scan, switchWallet });
        findById(commands, 'wallet-lock').run();
        findById(commands, 'wallet-refresh').run();
        findById(commands, 'wallet-scan').run();
        findById(commands, 'wallet-switch').run();
        expect(lock).toHaveBeenCalledOnce();
        expect(refresh).toHaveBeenCalledOnce();
        expect(scan).toHaveBeenCalledOnce();
        expect(switchWallet).toHaveBeenCalledOnce();
    });
});

describe('parseFreeformCommands (§33.3)', () => {
    const withSend = () => {
        const composeSend = vi.fn();
        return { composeSend, ctx: { composeSend } };
    };

    it('returns [] for an empty or unrecognized query', () => {
        expect(parseFreeformCommands('', withSend().ctx)).toEqual([]);
        expect(parseFreeformCommands('   ', withSend().ctx)).toEqual([]);
        expect(parseFreeformCommands('open settings', withSend().ctx)).toEqual([]);
        // Incomplete intent (no ticker yet) must not match.
        expect(parseFreeformCommands('send 100', withSend().ctx)).toEqual([]);
    });

    it('parses "send <amount> <TICK>" into a Send command that composes the intent', () => {
        const { composeSend, ctx } = withSend();
        const out = parseFreeformCommands('send 100 mytoken', ctx);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ category: 'Suggested', title: 'Send 100 MYTOKEN' });
        out[0].run();
        expect(composeSend).toHaveBeenCalledWith({ amount: '100', tick: 'MYTOKEN' });
    });

    it('accepts "pay", decimals, and surrounding whitespace; upcases the ticker', () => {
        const { composeSend, ctx } = withSend();
        const out = parseFreeformCommands('  pay 1.5 xcp  ', ctx);
        expect(out[0].title).toBe('Send 1.5 XCP');
        out[0].run();
        expect(composeSend).toHaveBeenCalledWith({ amount: '1.5', tick: 'XCP' });
    });

    it('yields nothing when the shell did not supply composeSend', () => {
        expect(parseFreeformCommands('send 5 doge', {})).toEqual([]);
    });

    it("'Suggested' is a declared category so it groups correctly", () => {
        expect(COMMAND_CATEGORIES).toContain('Suggested');
    });
});

describe('contactsToCommands', () => {
    it('returns [] for non-array input', () => {
        expect(contactsToCommands(null, { navigate() {} })).toEqual([]);
        expect(contactsToCommands(undefined, { navigate() {} })).toEqual([]);
    });

    it('maps named contacts to commands, folding addresses into keywords', () => {
        const navigate = vi.fn();
        const out = contactsToCommands([
            { id: 'c1', name: 'Alice', entries: [{ address: 'bc1qalice' }, { address: 'ltc1qalice' }] },
            { id: 'c2', label: 'Bob', address: 'DBob' },
            { id: 'c3' }, // no name/label -> skipped
        ], { navigate });
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ id: 'contact-c1', title: 'Alice', category: 'Contacts' });
        expect(out[0].keywords).toContain('bc1qalice');
        expect(out[1].keywords).toContain('DBob');
        out[0].run();
        expect(navigate).toHaveBeenCalledWith('contacts');
    });
});
