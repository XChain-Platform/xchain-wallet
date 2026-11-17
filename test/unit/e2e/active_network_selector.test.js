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
// Unit: the regtest and testnet e2e fixtures choose the network by clicking its
// row on the Network page (Mainnet, Testnet, Regtest rows named "Select
// <Name>"), then confirm. Header controls carry labels such as
// "Active network: Mainnet", and Playwright's getByLabel matches substrings by
// default, so the fixtures never look the network up by that label. They share
// one exact lookup, networkOption in regtest.js, so each fixture selects
// through it and the helper itself is pinned to the exact row name.

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (rel) => fs.readFileSync(new URL(`../../e2e/fixtures/${rel}`, import.meta.url), 'utf8');

const SELECT_CALL = /networkOption\(\s*page\s*,\s*'(\w+)'\s*\)\.click\(\)/g;
const HELPER = /export function networkOption\(page, network\) \{[^}]*getByRole\('button', \{ name: `Select \$\{label\}`, exact: true \}\);/;

describe.each([
    ['regtest.js', 'regtest'],
    ['testnet.js', 'testnet'],
])('%s', (file, network) => {
    const src = read(file);
    const calls = [...src.matchAll(SELECT_CALL)];

    it('selects the network once', () => {
        expect(calls.map((m) => m[1])).toEqual([network]);
    });

    it('matches the row name exactly', () => {
        expect(read('regtest.js')).toMatch(HELPER);
    });

    it('has no substring-matching Active network lookup left', () => {
        const bare = src.match(/getByLabel\(\s*'Active network'\s*\)/g);
        expect(bare).toBeNull();
    });
});
