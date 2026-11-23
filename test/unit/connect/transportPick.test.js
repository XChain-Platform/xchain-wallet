// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    MIN_PROVIDER_VERSION,
    androidIntentUrl,
    pickTransport,
    providerReady,
} from '../../../packages/connect/src/transportPick.js';

describe('providerReady', () => {
    it('exposes the minimum provider version', () => {
        expect(MIN_PROVIDER_VERSION).toBe('0.2.0');
    });

    it.each([
        ['0.2.0', true],
        ['0.10.0', true],
        ['1.0.0', true],
        ['0.1.9', false],
        ['0.2', false],
        ['v0.2.0', false],
        [undefined, false],
    ])('evaluates version %s as %s', (version, expected) => {
        expect(providerReady({ version })).toBe(expected);
    });

    it('rejects values that are not provider objects', () => {
        expect(providerReady(null)).toBe(false);
        expect(providerReady('0.2.0')).toBe(false);
    });

    it('does not coerce a provider version to a string', () => {
        expect(providerReady({ version: { toString: () => '0.2.0' } })).toBe(false);
    });
});

describe('androidIntentUrl', () => {
    const httpsLink = 'https://wallet.xchain.io/link/?uri=xchain%3Arequest%3Fv%3D1%26req%3Dabc_123-XYZ';

    it('builds an intent with the published link as its fallback', () => {
        const intent = androidIntentUrl(httpsLink);
        const expectedPrefix = 'intent://wallet.xchain.io/link/?uri=xchain%3Arequest%3Fv%3D1%26req%3Dabc_123-XYZ';

        expect(intent).toBe(
            `${expectedPrefix}#Intent;scheme=https;package=io.xchain.wallet.android;S.browser_fallback_url=${encodeURIComponent(httpsLink)};end`
        );

        const encodedFallback = intent.match(/S\.browser_fallback_url=([^;]+);end$/)[1];
        expect(decodeURIComponent(encodedFallback)).toBe(httpsLink);
    });

    it('uses a custom Android package name', () => {
        expect(androidIntentUrl(httpsLink, { packageName: 'io.example.wallet' }))
            .toContain(';package=io.example.wallet;');
    });

    it('refuses an http link', () => {
        expect(() => androidIntentUrl('http://wallet.xchain.io/link/?uri=test'))
            .toThrow(TypeError);
    });
});

describe('pickTransport', () => {
    const readyProvider = { version: '0.2.0' };
    const unavailableProvider = { version: '0.1.9' };

    it.each(['android', 'ios', 'desktop'])(
        'prefers a ready provider on %s',
        (platform) => {
            expect(pickTransport({ provider: readyProvider, platform }))
                .toEqual({ kind: 'provider' });
        }
    );

    it.each([
        ['android', 'intent'],
        ['ios', 'universal-link'],
        ['desktop', 'chooser'],
    ])('selects %s fallback transport %s', (platform, kind) => {
        expect(pickTransport({ provider: unavailableProvider, platform }))
            .toEqual({ kind });
    });

    it.each(['app', 'web', 'get'])(
        'restores the remembered desktop %s pick',
        (rememberedPick) => {
            expect(pickTransport({
                provider: unavailableProvider,
                platform: 'desktop',
                rememberedPick,
            })).toEqual({ kind: rememberedPick });
        }
    );

    it.each(['android', 'ios'])(
        'ignores a remembered pick on %s',
        (platform) => {
            expect(pickTransport({
                provider: unavailableProvider,
                platform,
                rememberedPick: 'app',
            })).toEqual({
                kind: platform === 'android' ? 'intent' : 'universal-link',
            });
        }
    );

    it('uses the chooser for an unrecognized desktop pick', () => {
        expect(pickTransport({
            provider: unavailableProvider,
            platform: 'desktop',
            rememberedPick: 'other',
        })).toEqual({ kind: 'chooser' });
    });

    it('refuses an unknown platform even when a provider is ready', () => {
        expect(() => pickTransport({ provider: readyProvider, platform: 'tablet' }))
            .toThrow(TypeError);
    });
});
