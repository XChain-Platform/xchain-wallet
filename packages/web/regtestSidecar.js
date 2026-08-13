// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keep the regtest full-node SIDECAR out of a `store` build .
//
// The coin registry (`xchain-sdk/src/coins/index.js`, canonical in
// `xchain-hub`) resolves the FULLNODE block per network, and on regtest it
// merges a `fullnode.regtest.json` file sitting next to a developer's node.
// That is a file on a disk, so it is Node-only by nature, and it is reached
// through `path.resolve(process.cwd(), ...)`.
//
// In a WebView neither exists. Before the SDK grew its `hasNodeFilesystem()`
// capability check the call threw on every launch of both mobile shells and
// the catch turned it into a console line reading "FULLNODE regtest sidecar
// ignored: r.resolve is not a function" - a wallet in an app-store build
// telling its user about a full-node dev path. The capability check fixed the
// SYMPTOM; the code and its config literal still ship, and an artifact bound
// for App Review is exactly where a dev-only path should not exist at all
// (§2.3, the same argument that compiles the store-hidden surfaces out rather
// than switching them off).
//
// So this removes them from the `store` profile, and only from it:
//
//   - `$regtestSidecar: 'fullnode.regtest.json'` in the coin data, and
//   - the `if (fullnode.$regtestSidecar && hasNodeFilesystem()) { … }` block
//     that reads it.
//
// BEHAVIOR-NEUTRAL BY CONSTRUCTION, which is why it is safe to do at build
// time to someone else's package: the block it deletes is guarded by a
// capability check that is false in every browser and every WebView, so a
// `store` bundle could never have executed it. `default` builds are untouched,
// because the desktop shell wraps the same SPA and a developer running it
// against a local regtest node is a real user of that sidecar.
//
// HASH-NEUTRAL TOO, and that part is not obvious: the `$`-prefixed keys are
// descriptors, and `consensusSubset()` strips every descriptor before hashing
// (`stripDescriptors(coin.FULLNODE)`), so removing one cannot move
// CONSENSUS_CONFIG_PIN and cannot make a store build fail pin verification.
//
// FAILS SHUT. The transform is string surgery over a dependency we do not
// own, so the guarantee is not "the regex matched": `generateBundle` scans the
// emitted `store` bundle for the markers and refuses the build if any survive.
// A future SDK that rewrites this code into a shape the transform does not
// recognize breaks the build with a message naming the chunk, rather than
// quietly shipping the thing again.
//
// BUILD-ONLY, like `sri.js` and `buildProfile.js` beside it: nothing here
// reaches the browser bundle.

/** The profile this cleanup applies to. Owned by `src/csp.js`; see below. */
export const STORE_PROFILE = 'store';

/** The descriptor key in the coin data, and the property the loader reads. */
export const SIDECAR_KEY = '$regtestSidecar';

/**
 * Text that must not appear anywhere in a `store` bundle.
 *
 * The literal filename and the log line are listed beside the key because the
 * key alone is not the whole footprint: the log line is the string a user
 * actually saw in the console, and the filename is the dev-only artifact the
 * store build has no business naming.
 */
export const REGTEST_SIDECAR_MARKERS = Object.freeze([
    SIDECAR_KEY,
    'fullnode.regtest.json',
    'FULLNODE regtest sidecar ignored',
]);

/** Where the loader block starts. Located, then delimiter-matched (see below). */
const LOADER_START = /if\s*\(\s*fullnode\s*\.\s*\$regtestSidecar\b/;

/**
 * The `$regtestSidecar: '<file>'` data property, whole line.
 *
 * Anchored to a line so it cannot eat a neighbouring key, and the trailing
 * comma is optional so a last-in-object position still matches.
 */
const SIDECAR_PROPERTY = /^[ \t]*\$regtestSidecar[ \t]*:[ \t]*(['"]).*?\1[ \t]*,?[ \t]*\r?\n/gm;

/**
 * A whole-line comment: `//…`, or a `*` continuation line inside a block.
 *
 * Comment lines that MENTION the sidecar go too. Minification drops them
 * anyway, so this changes no shipped byte today; it exists so the check below
 * can be a flat "no marker anywhere" rather than "no marker except in the
 * comments", which is the kind of exception that later swallows a real one.
 *
 * A lone block-comment terminator is excluded, and so is a line that OPENS a
 * block: dropping either would leave a comment open, or end one that never
 * started, and take the rest of the file with it.
 */
const COMMENT_LINE = /^[ \t]*(?:\/\/|\*(?!\/))/;

/**
 * Index just past the delimiter matching the one at `open`.
 *
 * Hand-written rather than regex because the body it has to skip contains
 * strings and comments, and a brace inside either is not a brace. Returns -1
 * when the delimiter never closes, which the callers treat as "shape not
 * recognized" and leave the code alone for the artifact scan to catch.
 *
 * @param {string} code
 * @param {number} open index of the opening delimiter
 * @returns {number}
 */
function matchDelimiter(code, open) {
    const CLOSING = { '(': ')', '{': '}', '[': ']' };
    const close = CLOSING[code[open]];
    if (!close) return -1;
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
        const ch = code[i];
        const next = code[i + 1];
        if (ch === '/' && next === '/') {
            const nl = code.indexOf('\n', i);
            if (nl === -1) return -1;
            i = nl;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = code.indexOf('*/', i + 2);
            if (end === -1) return -1;
            i = end + 1;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            for (i += 1; i < code.length; i += 1) {
                if (code[i] === '\\') { i += 1; continue; }
                if (code[i] === ch) break;
            }
            if (i >= code.length) return -1;
            continue;
        }
        if (ch === code[open]) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * Remove the sidecar-reading `if` block, if it is there in the shape we know.
 *
 * Anything else - a braceless body, an `else` arm, a condition that never
 * closes - is left ALONE rather than approximated. Half-deleting a statement
 * in a dependency is a worse outcome than shipping the dead code, and the
 * bundle scan turns "left alone" into a failed build anyway.
 *
 * @param {string} code
 * @returns {{ code: string, removed: boolean }}
 */
export function removeSidecarLoader(code) {
    const start = code.search(LOADER_START);
    if (start === -1) return { code, removed: false };

    const openParen = code.indexOf('(', start);
    const afterCond = matchDelimiter(code, openParen);
    if (afterCond === -1) return { code, removed: false };

    const openBrace = code.slice(afterCond).search(/^\s*\{/);
    if (openBrace === -1) return { code, removed: false };
    const braceAt = code.indexOf('{', afterCond);
    const afterBody = matchDelimiter(code, braceAt);
    if (afterBody === -1) return { code, removed: false };

    // An `else` arm would mean the deletion changes control flow rather than
    // removing a branch that could never run. Not our shape; leave it.
    if (/^\s*else\b/.test(code.slice(afterBody))) return { code, removed: false };

    return {
        code: `${code.slice(0, start)}${code.slice(afterBody)}`,
        removed: true,
    };
}

/**
 * Strip the sidecar loader and its config literal from one module's source.
 *
 * @param {string} code
 * @returns {{ code: string, removed: string[] }} `removed` names what went,
 *   for the build log and for tests that need more than "something changed".
 */
export function stripRegtestSidecar(code) {
    const removed = [];
    let out = String(code);

    const withoutProperty = out.replace(SIDECAR_PROPERTY, '');
    if (withoutProperty !== out) {
        removed.push('config');
        out = withoutProperty;
    }

    const loader = removeSidecarLoader(out);
    if (loader.removed) {
        removed.push('loader');
        out = loader.code;
    }

    const withoutComments = out.split('\n')
        .filter((line) => !(COMMENT_LINE.test(line) && findRegtestSidecarMarkers(line).length > 0))
        .join('\n');
    if (withoutComments !== out) {
        removed.push('comments');
        out = withoutComments;
    }

    return { code: out, removed };
}

/**
 * Which forbidden markers `text` still contains, in declaration order.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function findRegtestSidecarMarkers(text) {
    const s = String(text ?? '');
    return REGTEST_SIDECAR_MARKERS.filter((marker) => s.includes(marker));
}

/**
 * The Vite plugin. Inert unless this build is the `store` profile.
 *
 * `enforce: 'pre'` so the transform sees the SDK's own source, before the
 * CommonJS-to-ESM pass rewrites it into a wrapper; the shapes matched above
 * are the ones in that source.
 *
 * @param {string} profile the resolved build profile
 * @returns {import('vite').Plugin}
 */
export function regtestSidecarPlugin(profile) {
    const active = profile === STORE_PROFILE;
    let touched = 0;

    return {
        name: 'xchain-regtest-sidecar-strip',
        apply: 'build',
        enforce: 'pre',

        transform(code, id) {
            if (!active || !code.includes(SIDECAR_KEY)) return null;
            const { code: out, removed } = stripRegtestSidecar(code);
            if (removed.length === 0) return null;
            touched += 1;
            this.info?.(`regtest-sidecar: removed ${removed.join(' + ')} from ${id}`);
            // No sourcemap: the `store` profile builds with sourcemap off (they
            // are SHIPPED inside the app bundle rather than fetched on demand),
            // so there is no map for this to invalidate.
            return { code: out, map: null };
        },

        // The guarantee. Everything above is an attempt; this is the check.
        generateBundle(_options, bundle) {
            if (!active) return;
            for (const [fileName, output] of Object.entries(bundle)) {
                const text = output.type === 'chunk'
                    ? output.code
                    : (typeof output.source === 'string' ? output.source : null);
                if (text === null) continue;
                const found = findRegtestSidecarMarkers(text);
                if (found.length > 0) {
                    this.error(
                        `build profile "${STORE_PROFILE}" must not ship the regtest`
                        + ` full-node sidecar, but ${fileName} still contains:`
                        + ` ${found.join(', ')}. The strip in`
                        + ' packages/web/regtestSidecar.js did not recognize the'
                        + ' shape it was given - most likely xchain-sdk rewrote'
                        + ' resolveFullnode(). Update the transform there rather'
                        + ' than the scan .',
                    );
                }
            }
            if (touched === 0) {
                this.warn(
                    'regtest-sidecar: nothing was stripped; the SDK may no longer'
                    + ` carry ${SIDECAR_KEY}, in which case this plugin can go.`,
                );
            }
        },
    };
}
