// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    scoreText,
    scoreCommand,
    filterCommands,
} from '../../../packages/core/src/shared/commandPalette/fuzzyMatch.js';

const cmd = (title, extra = {}) => ({ id: title, category: 'Navigate', title, run() {}, ...extra });

describe('scoreText', () => {
    it('ranks exact > prefix > acronym > substring > subsequence > miss', () => {
        const q = 'send';
        const exact = scoreText('send', 'Send');
        const prefix = scoreText('sen', 'Send');
        const substring = scoreText('end', 'Send');
        const subseq = scoreText('sd', 'Send');
        const miss = scoreText('xyz', 'Send');
        expect(exact).toBeGreaterThan(prefix);
        expect(prefix).toBeGreaterThan(substring);
        expect(substring).toBeGreaterThan(subseq);
        expect(miss).toBe(0);
        expect(scoreText(q, 'Send')).toBeGreaterThan(0);
    });

    it('matches word-boundary acronyms', () => {
        // "mt" -> "My Tokens", "ct" -> "Create a token"
        expect(scoreText('mt', 'My Tokens')).toBeGreaterThan(0);
        expect(scoreText('cat', 'Create a token')).toBeGreaterThan(0);
        expect(scoreText('ct', 'Create a token')).toBeGreaterThan(0);
    });

    it('is case-insensitive', () => {
        expect(scoreText('send', 'SEND')).toBe(scoreText('send', 'send'));
    });
});

describe('scoreCommand', () => {
    it('weights a title hit above a keyword-only hit', () => {
        const titleHit = scoreCommand('swap', cmd('Swap'));
        const keywordHit = scoreCommand('swap', cmd('Cross-chain', { keywords: ['swap'] }));
        expect(titleHit).toBeGreaterThan(keywordHit);
        expect(keywordHit).toBeGreaterThan(0);
    });

    it('finds a command by a keyword the title does not contain', () => {
        expect(scoreCommand('dex', cmd('Open markets', { keywords: ['dex', 'exchange'] }))).toBeGreaterThan(0);
    });
});

describe('filterCommands', () => {
    const commands = [
        cmd('Home'),
        cmd('History'),
        cmd('Send'),
        cmd('Settings'),
        cmd('Cross-chain swap', { keywords: ['bridge'] }),
    ];

    it('returns all commands (original order) for an empty query', () => {
        const out = filterCommands(commands, '   ');
        expect(out.map((c) => c.title)).toEqual(commands.map((c) => c.title));
    });

    it('drops non-matches and ranks matches best-first', () => {
        const out = filterCommands(commands, 'se');
        const titles = out.map((c) => c.title);
        // "Send" (prefix) and "Settings" (prefix) match; "Home"/"History" do not.
        expect(titles).toContain('Send');
        expect(titles).toContain('Settings');
        expect(titles).not.toContain('Home');
    });

    it('finds a command via its keyword', () => {
        const out = filterCommands(commands, 'bridge');
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Cross-chain swap');
    });

    it('excludes disabled commands', () => {
        const out = filterCommands([...commands, cmd('Hidden', { disabled: true })], '');
        expect(out.map((c) => c.title)).not.toContain('Hidden');
    });

    it('is stable: equal scores keep original order', () => {
        const a = cmd('Refresh account');
        const b = cmd('Refresh addresses');
        const out = filterCommands([a, b], 'refresh');
        expect(out.map((c) => c.title)).toEqual(['Refresh account', 'Refresh addresses']);
    });
});
