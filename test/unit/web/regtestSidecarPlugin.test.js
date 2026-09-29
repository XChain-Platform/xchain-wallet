// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Vite plugin itself, driven with a stub Rollup context. regtestSidecar.test.js
// covers the string surgery; this covers the guard that fails a store build shut.
//
//   1. `generateBundle` under `store` throws through `this.error` on any
//      surviving marker, in a chunk or a string asset, so a downgrade to
//      `this.warn` turns this red.
//   2. The plugin is inert in every other profile: the gate is exactly
//      `store`, never inverted and never widened into `default`.
//   3. Under `store` the transform really strips the SDK source that ships.
//
// The wiring into both vite configs is pinned by
// test/smoke/security/regtest-sidecar-wiring.smoke.js.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import {
    REGTEST_SIDECAR_MARKERS,
    SIDECAR_KEY,
    STORE_PROFILE,
    findRegtestSidecarMarkers,
    regtestSidecarPlugin,
} from '../../../packages/web/regtestSidecar.js';
import { BUILD_PROFILES } from '../../../packages/web/buildProfile.js';

const require = createRequire(import.meta.url);
const sdkCoins = dirname(require.resolve('xchain-sdk/src/coins/index.js'));
// Every installed SDK coins file that carries the key, read as the build sees it.
const SDK_CARRIERS = readdirSync(sdkCoins)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, source: readFileSync(join(sdkCoins, file), 'utf8') }))
    .filter(({ source }) => source.includes(SIDECAR_KEY));

// A stub Rollup context whose `error` throws, as Rollup's does.
const makeCtx = () => ({
    error: vi.fn((msg) => { throw new Error(String(msg)); }),
    warn: vi.fn(),
    info: vi.fn(),
});

const chunk = (code) => ({ type: 'chunk', code });
const asset = (source) => ({ type: 'asset', source });

const NON_STORE_PROFILES = [...BUILD_PROFILES.filter((p) => p !== STORE_PROFILE), undefined, 'STORE'];

describe('regtestSidecarPlugin shape', () => {
    it('is a pre-enforced, build-only plugin with a stable name', () => {
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        expect(plugin.name).toBe('xchain-regtest-sidecar-strip');
        expect(plugin.apply).toBe('build');
        expect(plugin.enforce).toBe('pre');
    });

    it('has profiles to test on both sides of the gate', () => {
        expect(BUILD_PROFILES).toContain(STORE_PROFILE);
        expect(BUILD_PROFILES.filter((p) => p !== STORE_PROFILE).length).toBeGreaterThan(0);
        expect(SDK_CARRIERS.length).toBeGreaterThan(0);
    });
});

describe('generateBundle fails a store build shut', () => {
    it.each([...REGTEST_SIDECAR_MARKERS])('throws on a chunk still carrying %s', (marker) => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        expect(() => plugin.generateBundle.call(ctx, {}, { 'a.js': chunk(`x=${JSON.stringify(marker)}`) }))
            .toThrow(/a\.js/);
        expect(ctx.error).toHaveBeenCalledTimes(1);
        expect(String(ctx.error.mock.calls[0][0])).toContain(marker);
    });

    it.each([...REGTEST_SIDECAR_MARKERS])('throws on a string asset still carrying %s', (marker) => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        expect(() => plugin.generateBundle.call(ctx, {}, { 'a.css': asset(`/* ${marker} */`) }))
            .toThrow(/a\.css/);
        expect(ctx.error).toHaveBeenCalledTimes(1);
    });

    it('skips a binary asset rather than scanning it', () => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        expect(() => plugin.generateBundle.call(ctx, {}, { 'img.png': asset(new Uint8Array([1, 2, 3])) }))
            .not.toThrow();
        expect(ctx.error).not.toHaveBeenCalled();
    });

    it('passes a clean bundle and warns that nothing was stripped', () => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        plugin.generateBundle.call(ctx, {}, { 'a.js': chunk('const a = 1;') });
        expect(ctx.error).not.toHaveBeenCalled();
        expect(ctx.warn).toHaveBeenCalledTimes(1);
    });
});

describe('the store transform strips the SDK source that ships', () => {
    it('removes every marker from each carrier and then stays quiet', () => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(STORE_PROFILE);
        for (const { file, source } of SDK_CARRIERS) {
            const out = plugin.transform.call(ctx, source, `xchain-sdk/src/coins/${file}`);
            expect(out, file).not.toBeNull();
            expect(findRegtestSidecarMarkers(out.code), file).toEqual([]);
        }
        plugin.generateBundle.call(ctx, {}, { 'a.js': chunk('const a = 1;') });
        expect(ctx.warn).not.toHaveBeenCalled();
    });
});

describe('the plugin is inert outside the store profile', () => {
    it.each(NON_STORE_PROFILES)('does nothing under profile %s', (profile) => {
        const ctx = makeCtx();
        const plugin = regtestSidecarPlugin(profile);
        for (const { file, source } of SDK_CARRIERS) {
            expect(plugin.transform.call(ctx, source, `xchain-sdk/src/coins/${file}`), file).toBeNull();
        }
        const marked = Object.fromEntries(REGTEST_SIDECAR_MARKERS.map((m, i) => [`m${i}.js`, chunk(m)]));
        expect(() => plugin.generateBundle.call(ctx, {}, marked)).not.toThrow();
        expect(ctx.error).not.toHaveBeenCalled();
        expect(ctx.warn).not.toHaveBeenCalled();
    });
});
