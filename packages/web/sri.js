// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Subresource Integrity for the web SPA build (G-SRI).
//
// The CSP (src/csp.js) says WHERE scripts may come from ('self'). It says
// nothing about WHAT those scripts contain. For a self-custodial wallet, the
// asset-serving path is exactly the thing you cannot afford to trust silently:
// anyone who can alter a JS bundle in transit or at rest on the host (a
// compromised CDN or bucket, a bad deploy, a tampering proxy) gets to run code
// in a page that holds the user's decrypted seed. SRI closes that: index.html
// carries a cryptographic hash of every script and stylesheet it loads, and the
// browser refuses to execute an asset whose bytes don't match.
//
// The integrity hashes are computed in `writeBundle`, from the emitted files as
// they exist ON DISK, so they cover exactly the bytes that ship (the note on
// `sriPlugin` below says why the in-memory chunk is the wrong source).
//
// This is not a substitute for signing index.html itself: whoever can rewrite a
// bundle can usually also rewrite the HTML that vouches for it. What it buys is
// (a) an asset host that is no longer independently trusted, which matters
// because assets are the part most likely to sit on a CDN, and (b) a build whose
// output can be verified byte-for-byte against a published hash by anyone
// (pairs with the reproducible-build work).
//
// Node-side build code: `node:crypto` is intentional here and never reaches the
// browser bundle.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Hash algorithm for the integrity attribute. sha384 is the SRI default. */
export const SRI_ALGORITHM = 'sha384';

/**
 * The `integrity` attribute value for a chunk of asset bytes.
 *
 * @param {string | Uint8Array} source
 * @returns {string} e.g. "sha384-Ln0s…"
 */
export function integrityFor(source) {
    const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
    const digest = createHash(SRI_ALGORITHM).update(bytes).digest('base64');
    return `${SRI_ALGORITHM}-${digest}`;
}

// Matches the src/href of a local <script> / <link> tag. Skips anything
// absolute (http:, https:, //cdn, data:) because we have no bytes for it, and an
// integrity attribute we cannot compute is worse than none: it would silently
// fail closed at runtime.
const TAG = /<(script|link)\b[^>]*?\s(?:src|href)=["']([^"']+)["'][^>]*>/gi;

function isLocal(url) {
    return !/^(?:[a-z]+:)?\/\//i.test(url) && !url.startsWith('data:');
}

// Only these carry executable / style weight. A <link rel="icon"> needs no
// integrity, and adding one to a favicon is a deploy footgun for no gain.
function wantsIntegrity(tag) {
    if (/^<script/i.test(tag)) return true;
    return /rel=["'](?:stylesheet|modulepreload)["']/i.test(tag);
}

/**
 * Rewrite an index.html, adding `integrity` (and `crossorigin`) to every local
 * script/stylesheet/modulepreload tag whose bytes `lookup` can supply.
 *
 * A tag whose asset is not found in the bundle is left ALONE rather than given a
 * guessed hash: a wrong integrity value breaks the page, and a silently-skipped
 * one is visible in the smoke check.
 *
 * The two ways into `skipped` are NOT the same event, so they come back apart as
 * well. An EXTERNAL url is correct behaviour: there are no bytes to hash, and a
 * guessed integrity would fail the page closed. A LOCAL url the lookup could not
 * resolve is a defect: those are bytes the page WILL execute, they should have
 * been hashed, and nothing downstream could tell the two apart while both landed
 * in one list that was only ever printed. `skipped` stays as the union so an
 * existing caller keeps working.
 *
 * @param {string} html
 * @param {(fileName: string) => (string | Uint8Array | undefined)} lookup
 *        resolves an asset path from the HTML (e.g. "/assets/main-a1b2.js") to its emitted bytes
 * @returns {{ html: string, hashed: string[], skipped: string[],
 *            skippedExternal: string[], skippedLocal: string[] }}
 */
export function addIntegrityAttributes(html, lookup) {
    const hashed = [];
    const skippedExternal = [];
    const skippedLocal = [];

    const out = html.replace(TAG, (tag, _tagName, url) => {
        if (!wantsIntegrity(tag)) return tag;
        if (!isLocal(url)) {
            skippedExternal.push(url);
            return tag;
        }
        if (/\sintegrity=/i.test(tag)) return tag;   // already carries one

        const source = lookup(url);
        if (source === undefined) {
            skippedLocal.push(url);
            return tag;
        }

        hashed.push(url);
        // crossorigin is required for SRI to be enforced on a CORS-fetched
        // subresource; harmless same-origin, and the assets may well be served
        // from a separate origin later.
        const withCrossOrigin = /\scrossorigin[\s=>]/i.test(tag)
            ? tag
            : tag.replace(/^<(script|link)\b/i, '<$1 crossorigin="anonymous"');
        return withCrossOrigin.replace(
            /^<(script|link)\b/i,
            `<$1 integrity="${integrityFor(source)}"`,
        );
    });

    return {
        html: out,
        hashed,
        skipped: [...skippedExternal, ...skippedLocal],
        skippedExternal,
        skippedLocal,
    };
}

/**
 * Vite plugin: inject SRI hashes into the built HTML.
 *
 * Build-only. In dev, assets are served by Vite's HMR pipeline and rewritten on
 * the fly, so a hash pinned at page-load would be wrong within seconds; dev is
 * also not the deployed threat surface (same reasoning as the CSP plugin).
 *
 * Runs in `writeBundle`, hashing the files as they exist ON DISK, rather than in
 * transformIndexHtml against `chunk.code`. That is not a stylistic choice: with
 * `build.sourcemap` on, Vite appends a `//# sourceMappingURL=` comment to the
 * file it writes, so `chunk.code` is NOT the bytes the browser fetches. Hashing
 * the in-memory chunk produced a valid-looking integrity attribute that no
 * served asset could ever match, and the browser's response to that is to refuse
 * to execute the bundle: a blank wallet on deploy. Hash what actually ships.
 *
 * @returns {import('vite').Plugin}
 */
export function sriPlugin() {
    let outDir = 'dist';
    let logger = console;
    return {
        name: 'xchain-sri',
        apply: 'build',
        enforce: 'post',
        configResolved(config) {
            if (config?.logger) logger = config.logger;
            if (config?.build?.outDir) {
                outDir = resolve(config.root ?? process.cwd(), config.build.outDir);
            }
        },
        // After every file is on disk, so the bytes hashed are the bytes served.
        writeBundle(_options, bundle) {
            const htmlFiles = Object.keys(bundle).filter((f) => f.endsWith('.html'));

            for (const htmlFile of htmlFiles) {
                const htmlPath = join(outDir, htmlFile);
                if (!existsSync(htmlPath)) continue;

                const lookup = (url) => {
                    // Vite emits root-relative hrefs ("/assets/x.js"); on disk
                    // they live under outDir ("<outDir>/assets/x.js").
                    const rel = url.replace(/^\/+/, '').split(/[?#]/)[0];
                    const assetPath = join(outDir, rel);
                    if (!existsSync(assetPath)) return undefined;
                    return readFileSync(assetPath);
                };

                const { html, hashed, skippedExternal, skippedLocal } = addIntegrityAttributes(
                    readFileSync(htmlPath, 'utf8'),
                    lookup,
                );
                writeFileSync(htmlPath, html);

                // Say what was covered. A silent SRI pass that hashed nothing is
                // indistinguishable from no SRI at all, which is the failure mode
                // worth being loud about.
                logger.info(
                    `sri: ${htmlFile}: ${hashed.length} asset(s) hashed with ${SRI_ALGORITHM}`
                    + (skippedExternal.length
                        ? `; ${skippedExternal.length} external (${skippedExternal.join(', ')})`
                        : ''),
                );
                // A LOCAL url that could not be resolved on disk is not a skip,
                // it is a same-origin subresource the page will execute with no
                // integrity. The likeliest cause is ordering: a public-dir file
                // (public/boot-check.js) not yet copied when this hook runs. Loud
                // in EVERY build path, including release and mobile, which run no
                // SRI smoke at all. Not a hard build error: this hook also walks
                // any other HTML entry in the bundle, whose relative urls resolve
                // against outDir rather than their own directory, so a throw here
                // could brick a release on a path-resolution quirk rather than a
                // real integrity hole. The CI gate is the smoke.
                if (skippedLocal.length) {
                    logger.warn(
                        `sri: ${htmlFile}: ${skippedLocal.length} LOCAL asset(s) could not be hashed `
                        + `(${skippedLocal.join(', ')}); the page executes them with no integrity`,
                    );
                }
                if (hashed.length === 0) {
                    logger.warn(
                        `sri: ${htmlFile} carries no integrity attributes; nothing was hashed`,
                    );
                }
            }
        },
    };
}
