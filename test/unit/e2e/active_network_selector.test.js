// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node
//
// Unit: the regtest and testnet e2e fixtures pick the Settings network select
// by its EXACT label. Header controls now carry labels such as
// "Active network: Mainnet" and "Active network in header", and Playwright's
// getByLabel matches substrings by default, so a bare 'Active network' would
// resolve to several elements and fail strict mode. The fixtures share one
// exact lookup, activeNetworkControl in regtest.js, so each fixture selects
// through it and the helper itself is pinned to the exact label.

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (rel) => fs.readFileSync(new URL(`../../e2e/fixtures/${rel}`, import.meta.url), 'utf8');

const SELECT_CALL = /(?:getByLabel\(\s*'Active network'\s*(?:,\s*\{([^}]*)\})?\s*\)|activeNetworkControl\(\s*page\s*\))\s*\.selectOption\(\s*'(\w+)'\s*\)/g;
const HELPER = /export function activeNetworkControl\(page\) \{\s*return page\.getByRole\('combobox', \{ name: 'Active network', exact: true \}\);/;

describe.each([
    ['regtest.js', 'regtest'],
    ['testnet.js', 'testnet'],
])('%s', (file, network) => {
    const src = read(file);
    const calls = [...src.matchAll(SELECT_CALL)];

    it('selects the network once', () => {
        expect(calls.map((m) => m[2])).toEqual([network]);
    });

    it('matches the label exactly', () => {
        for (const m of calls) {
            if (m[0].startsWith('activeNetworkControl')) expect(read('regtest.js')).toMatch(HELPER);
            else expect(m[1]).toMatch(/\bexact:\s*true\b/);
        }
    });

    it('has no substring-matching Active network lookup left', () => {
        const bare = src.match(/getByLabel\(\s*'Active network'\s*\)/g);
        expect(bare).toBeNull();
    });
});
