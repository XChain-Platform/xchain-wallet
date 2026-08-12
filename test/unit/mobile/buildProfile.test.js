// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build profiles, and the one policy difference that currently defines them
// (, ; rails §3 owns the names, tools/release records them in
// the signed manifest).
//
// The property under test is not "the store profile drops an origin". It is
// that the two profiles differ in a way a build can be CHECKED against, and
// that the difference can only ever be subtractive. A profile that could ADD
// origins would be a way to widen the wallet's main structural defence
// against an XSS payload inside a build nobody reviews as closely as the web
// one, which is a worse deal than the duplication it would save.

import { describe, it, expect } from 'vitest';
import {
    BUILD_PROFILES,
    CONTENT_SECURITY_POLICY,
    DEFAULT_BUILD_PROFILE,
    contentSecurityPolicyFor,
    cspMetaTag,
    directivesFor,
} from '../../../packages/web/src/csp.js';
import {
    PROFILE_STAMP_FILE,
    parseProfileStamp,
    profileStampFor,
    resolveBuildProfile,
} from '../../../packages/web/buildProfile.js';

const TREZOR = 'https://connect.trezor.io';

describe('the profiles themselves', () => {
    it('are exactly the two rails §3 declares', () => {
        // A third is a spec change, not an implementation choice: every reader
        // of a signed manifest has to know what the name means.
        expect([...BUILD_PROFILES]).toEqual(['default', 'store']);
        expect(DEFAULT_BUILD_PROFILE).toBe('default');
    });

    it('refuse a name nobody declared instead of guessing', () => {
        expect(() => directivesFor('mobile')).toThrow(/unknown build profile/);
        expect(() => contentSecurityPolicyFor('')).toThrow(/unknown build profile/);
    });
});

// The whole policy, written out rather than imported. Importing DIRECTIVES to
// check DIRECTIVES is a tautology that passes for any value it happens to hold;
// these literals are a SECOND copy that a widening has to be made in twice, on
// purpose, so an added origin shows up as a failing diff and gets read by a
// human before it ships. Every subset assertion below this is a convenience;
// this is the one that actually holds the wallet's main XSS boundary.
const DEFAULT_POLICY = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://connect.trezor.io'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'frame-src': ["'self'", 'https://connect.trezor.io'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
        "'self'",
        'https:',
        'wss:',
        'http://localhost:*',
        'http://127.0.0.1:*',
        'ws://localhost:*',
        'ws://127.0.0.1:*',
    ],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
};

const STORE_POLICY = {
    ...DEFAULT_POLICY,
    'script-src': ["'self'"],
    'frame-src': ["'self'"],
};

describe('the exact policy each profile ships', () => {
    it('pins the default profile source-for-source', () => {
        // A subset check (toContain) says a known origin is still allowed; it
        // says nothing about an origin somebody ADDED. This is the assertion a
        // new remote script/frame origin has to get past.
        expect(directivesFor('default')).toEqual(DEFAULT_POLICY);
    });

    it('pins the store profile source-for-source', () => {
        expect(directivesFor('store')).toEqual(STORE_POLICY);
    });

    it('serializes to exactly those directives, in that order', () => {
        // The map is what the code reasons about; this string is what a browser
        // enforces, and cspMetaTag embeds it verbatim.
        const serialize = (policy) => Object.entries(policy)
            .map(([name, values]) => `${name} ${values.join(' ')}`)
            .join('; ');
        expect(contentSecurityPolicyFor('default')).toBe(serialize(DEFAULT_POLICY));
        expect(contentSecurityPolicyFor('store')).toBe(serialize(STORE_POLICY));
        expect(CONTENT_SECURITY_POLICY).toBe(serialize(DEFAULT_POLICY));
    });
});

describe('the store profile CSP', () => {
    it('drops the Trezor origins the default build needs', () => {
        // No WebHID in a WKWebView or an Android WebView, so the hardware
        // signer path is unreachable there by design. What is left without
        // this is a permanently-allowed third-party script origin for a
        // feature the build does not have.
        const dflt = directivesFor('default');
        const store = directivesFor('store');
        expect(dflt['script-src']).toContain(TREZOR);
        expect(dflt['frame-src']).toContain(TREZOR);
        expect(store['script-src']).not.toContain(TREZOR);
        expect(store['frame-src']).not.toContain(TREZOR);
        expect(contentSecurityPolicyFor('store')).not.toContain('trezor');
    });

    it('keeps every directive the default has, and adds nothing', () => {
        const dflt = directivesFor('default');
        const store = directivesFor('store');
        expect(Object.keys(store)).toEqual(Object.keys(dflt));
        for (const [name, values] of Object.entries(store)) {
            for (const value of values) {
                expect(dflt[name], `${name} gained ${value}`).toContain(value);
            }
        }
    });

    it('keeps the load-bearing XSS directives identical', () => {
        // These are the ones that actually stop an injected payload; a profile
        // must never be a way to relax them.
        const dflt = directivesFor('default');
        const store = directivesFor('store');
        for (const name of ['object-src', 'base-uri', 'form-action', 'frame-ancestors', 'img-src']) {
            expect(store[name]).toEqual(dflt[name]);
        }
        expect(contentSecurityPolicyFor('store')).not.toMatch(/unsafe-eval/);
    });

    it('does not mutate the shared directive table between calls', () => {
        directivesFor('store');
        expect(directivesFor('default')['script-src']).toContain(TREZOR);
        expect(CONTENT_SECURITY_POLICY).toContain(TREZOR);
    });

    it('renders a meta tag per profile', () => {
        expect(cspMetaTag('store')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
        expect(cspMetaTag('store')).not.toContain('trezor');
        expect(cspMetaTag()).toContain(TREZOR);
    });
});

describe('resolveBuildProfile', () => {
    it('defaults to `default`, so an ordinary build is unchanged', () => {
        expect(resolveBuildProfile({})).toBe('default');
        expect(resolveBuildProfile({ XCHAIN_BUILD_PROFILE: '' })).toBe('default');
    });

    it('reads the store profile from the environment', () => {
        expect(resolveBuildProfile({ XCHAIN_BUILD_PROFILE: 'store' })).toBe('store');
        expect(resolveBuildProfile({ XCHAIN_BUILD_PROFILE: ' store ' })).toBe('store');
    });

    it('throws on a typo rather than quietly building `default`', () => {
        // A typo producing a default build that a release then labels `store`
        // is exactly the false claim in a signed record this exists to stop.
        expect(() => resolveBuildProfile({ XCHAIN_BUILD_PROFILE: 'stroe' })).toThrow(/not a build profile/);
        expect(() => resolveBuildProfile({ XCHAIN_BUILD_PROFILE: 'STORE' })).toThrow(/not a build profile/);
    });
});

describe('the stamp that travels inside the bundle', () => {
    it('round-trips the profile', () => {
        // packages/mobile copies the web dist VERBATIM, so this file is the
        // only thing that can tell a store artifact from a default one.
        expect(PROFILE_STAMP_FILE).toBe('build-profile.txt');
        expect(parseProfileStamp(profileStampFor('store'))).toBe('store');
        expect(parseProfileStamp(profileStampFor('default'))).toBe('default');
    });

    it('reads an absent or unrecognized stamp as UNKNOWN, never as default', () => {
        // An unstamped bundle is one whose profile nobody recorded. Treating
        // that as `default` would be inventing a fact about shipped bytes.
        expect(parseProfileStamp('')).toBe(null);
        expect(parseProfileStamp('  ')).toBe(null);
        expect(parseProfileStamp('store-ish\n')).toBe(null);
        expect(parseProfileStamp(undefined)).toBe(null);
    });

    it('refuses to stamp a profile that does not exist', () => {
        expect(() => profileStampFor('mobile')).toThrow(/unknown build profile/);
    });
});
