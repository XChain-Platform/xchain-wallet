// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Subresource Integrity for the web SPA build.
//
// The CSP says WHERE scripts may load from ('self'); SRI pins WHAT they contain.
// For a wallet, the asset-serving path is the one thing you cannot afford to
// trust silently: whoever can swap a JS bundle gets to run code in a page that
// holds the user's decrypted seed.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    SRI_ALGORITHM,
    addIntegrityAttributes,
    integrityFor,
} from '../../../packages/web/sri.js';

const sha384 = (s) => `sha384-${createHash('sha384').update(Buffer.from(s)).digest('base64')}`;

describe('integrityFor', () => {
    it('produces a real sha384 base64 digest of the bytes', () => {
        expect(SRI_ALGORITHM).toBe('sha384');
        expect(integrityFor('console.log(1)')).toBe(sha384('console.log(1)'));
    });

    it('hashes a Buffer and the equivalent string identically', () => {
        expect(integrityFor(Buffer.from('a'))).toBe(integrityFor('a'));
    });

    it('changes when a single byte changes (it is actually content-bound)', () => {
        expect(integrityFor('a')).not.toBe(integrityFor('b'));
    });
});

describe('addIntegrityAttributes', () => {
    const assets = {
        '/assets/app.js': 'export const x = 1;',
        '/assets/app.css': ':root{color:red}',
    };
    const lookup = (url) => assets[url];

    it('adds integrity + crossorigin to a module script and a stylesheet', () => {
        const { html, hashed } = addIntegrityAttributes(
            '<script type="module" src="/assets/app.js"></script>'
            + '<link rel="stylesheet" href="/assets/app.css">',
            lookup,
        );
        expect(hashed).toEqual(['/assets/app.js', '/assets/app.css']);
        expect(html).toContain(`integrity="${sha384(assets['/assets/app.js'])}"`);
        expect(html).toContain(`integrity="${sha384(assets['/assets/app.css'])}"`);
        // crossorigin is required for SRI to be enforced on a CORS fetch.
        expect(html.match(/crossorigin/g)).toHaveLength(2);
    });

    it('adds integrity + crossorigin to a modulepreload link', () => {
        // The matcher's third arm, and the only one nothing covered. Vite emits
        // <link rel="modulepreload"> for chunks it wants fetched early, so those
        // bytes are executable weight that arrives BEFORE the tag importing
        // them. Dropping `modulepreload` from wantsIntegrity would strip SRI
        // from exactly that path and still pass every other test in this file.
        const preloaded = 'export const vendor = 2;';
        const { html, hashed } = addIntegrityAttributes(
            '<link rel="modulepreload" href="/assets/vendor.js">',
            () => preloaded,
        );
        expect(hashed).toEqual(['/assets/vendor.js']);
        expect(html).toContain(`integrity="${sha384(preloaded)}"`);
        expect(html.match(/crossorigin/g)).toHaveLength(1);
    });

    it('leaves a favicon link alone', () => {
        // An integrity attr on a favicon buys nothing and is a deploy footgun.
        const { html, hashed } = addIntegrityAttributes(
            '<link rel="icon" type="image/png" href="/favicon.png">',
            () => 'bytes',
        );
        expect(hashed).toEqual([]);
        expect(html).not.toContain('integrity');
    });

    it('skips an asset it has no bytes for rather than guessing a hash', () => {
        // A WRONG integrity value is worse than none: the browser refuses to
        // execute, so the page dies. Skipped assets are reported, not faked.
        const { html, skipped } = addIntegrityAttributes(
            '<script type="module" src="/assets/missing.js"></script>',
            () => undefined,
        );
        expect(skipped).toEqual(['/assets/missing.js']);
        expect(html).not.toContain('integrity');
    });

    it('skips a cross-origin script (we cannot hash bytes we do not have)', () => {
        const { html, skipped } = addIntegrityAttributes(
            '<script src="https://connect.trezor.io/9/trezor-connect.js"></script>',
            lookup,
        );
        expect(skipped).toEqual(['https://connect.trezor.io/9/trezor-connect.js']);
        expect(html).not.toContain('integrity');
    });

    it('does not double-add an integrity attribute', () => {
        const { html, hashed } = addIntegrityAttributes(
            '<script type="module" integrity="sha384-existing" src="/assets/app.js"></script>',
            lookup,
        );
        expect(hashed).toEqual([]);
        expect(html.match(/integrity=/g)).toHaveLength(1);
    });

    it('binds the hash to the served bytes, not to the tag', () => {
        // The bug this guards: hashing the in-memory chunk instead of the file
        // that ships. With build.sourcemap on, Vite appends a
        // "//# sourceMappingURL=" comment to the emitted .js, so the bytes the
        // browser fetches differ from chunk.code. A hash of the wrong bytes is a
        // valid-looking integrity attribute that NO served asset can match, and
        // the browser's answer to that is to refuse to run the bundle. The plugin
        // therefore hashes files on disk in writeBundle; this test pins the
        // property that any byte difference is a different hash.
        const shipped = `${assets['/assets/app.js']}\n//# sourceMappingURL=app.js.map\n`;
        const { html } = addIntegrityAttributes(
            '<script type="module" src="/assets/app.js"></script>',
            () => shipped,
        );
        expect(html).toContain(`integrity="${sha384(shipped)}"`);
        expect(html).not.toContain(`integrity="${sha384(assets['/assets/app.js'])}"`);
    });
});
