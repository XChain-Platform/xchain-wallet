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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HIDDEN_SURFACES } from '../../../packages/web/src/surfaces/registry.js';

function surfaceAliases(config) {
    return config.resolve.alias.filter(
        ({ replacement }) => /\/surfaces\/[^/]+\.hidden\.jsx$/.test(replacement),
    );
}

function profileMeta(config) {
    const plugin = config.plugins.flat(Infinity).find(({ name }) => name === 'xchain-csp');
    return plugin.transformIndexHtml().find(({ attrs }) => attrs?.name === 'xchain-build-profile');
}

async function importDefaultConfig() {
    process.env.XCHAIN_BUILD_PROFILE = 'default';
    return (await import('../../../packages/web/vite.config.js?store-profile-build=default')).default;
}

async function importStoreConfig() {
    process.env.XCHAIN_BUILD_PROFILE = 'store';
    return (await import('../../../packages/web/vite.config.js?store-profile-build=store')).default;
}

let defaultConfig;
let storeConfig;
let previousProfile;

beforeAll(async () => {
    previousProfile = process.env.XCHAIN_BUILD_PROFILE;
    defaultConfig = await importDefaultConfig();
    storeConfig = await importStoreConfig();
});

afterAll(() => {
    if (previousProfile === undefined) delete process.env.XCHAIN_BUILD_PROFILE;
    else process.env.XCHAIN_BUILD_PROFILE = previousProfile;
});

describe('XCHAIN_BUILD_PROFILE in the resolved Vite config', () => {
    it('selects the store profile at build time', () => {
        expect(profileMeta(defaultConfig).attrs.content).toBe('default');
        expect(profileMeta(storeConfig).attrs.content).toBe('store');
        expect(defaultConfig.build.sourcemap).toBe(true);
        expect(storeConfig.build.sourcemap).toBe(false);
    });

    it('aliases exactly the surfaces the profile registry documents', () => {
        const expected = HIDDEN_SURFACES.store;
        const aliases = surfaceAliases(storeConfig);

        expect(aliases).toHaveLength(expected.length);
        for (const surface of expected) {
            const alias = aliases.find(({ replacement }) => (
                replacement.endsWith(`/surfaces/${surface}.hidden.jsx`)
            ));
            expect(alias, `${surface} has a hidden-module alias`).toBeDefined();
            expect(alias.find.test(`./surfaces/${surface}.jsx`)).toBe(true);
            expect(alias.find.test(`../surfaces/${surface}.jsx`)).toBe(true);
        }

        expect(surfaceAliases(defaultConfig)).toEqual([]);
    });
});
