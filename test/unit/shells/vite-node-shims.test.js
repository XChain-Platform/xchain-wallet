// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  guard: both browser shells must shim `http` AND `https` to the
// no-op Agent module. xchain-sdk's explorer/encoder clients pick
// `require('https').Agent` for any https endpoint (every mainnet
// default); with only `http` aliased, constructing the real SDK threw
// "Agent is not a constructor" in the browser, and wallet creation
// silently never completed (G163). Asserting on the resolved config
// (not a source grep) keeps this honest across refactors.
//
// Node environment: importing the vite configs pulls in esbuild, which
// refuses to load under jsdom's patched TextEncoder.
// @vitest-environment node

import { describe, it, expect } from 'vitest';

const CONFIGS = [
    ['web', '../../../packages/web/vite.config.js'],
    ['extension', '../../../packages/extension/vite.config.js'],
];

describe.each(CONFIGS)('%s shell vite config', (_name, path) => {
    it('aliases http and https to the browser Agent shim', async () => {
        const mod = await import(path);
        const config = mod.default;
        const alias = config?.resolve?.alias;
        expect(alias, 'resolve.alias missing from config').toBeTruthy();
        expect(alias.http, 'http alias missing').toMatch(/http-browser\.js$/);
        expect(alias.https, 'https alias missing ').toBe(alias.http);
    });
});
