#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Glossary auto-appendix: Cluster T FOLLOWUP 3.
//
// Writes a "machine-derived" appendix into the wallet glossary between
// fenced markers, populated from canonical sources in the codebase
// that the human-written prose section depends on:
//
//  moved the glossary itself into the sibling xchain-documentation
// repo (components/wallet/glossary.md), published at
// https://docs.xchain.io/components/wallet/glossary. The canonical sources
// stay here, so this generator reaches across the two checkouts.
//
//   - BridgeErrorCode union   ← packages/bridge-spec/src/index.ts
//   - ConnectedSite permission keys ← packages/core/src/schemas/connectedSite.js
//
// The fenced markers below are recognised verbatim. The script (a)
// re-generates the appendix from source, (b) compares against the
// current file, and (c) either writes the file (no flags) or exits
// non-zero with a diff hint (`--check`) so a smoke / CI gate can
// catch drift.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..');
// Resolved from this script's own location, not cwd. Override with
// GLOSSARY_PATH when the sibling checkout lives somewhere else.
const DEFAULT_GLOSSARY_PATH = join(
    wsRoot, '..', 'xchain-documentation', 'components', 'wallet', 'glossary.md',
);
const GLOSSARY_PATH = process.env.GLOSSARY_PATH || DEFAULT_GLOSSARY_PATH;
const BRIDGE_SPEC_PATH = join(
    wsRoot, 'packages', 'bridge-spec', 'src', 'index.ts',
);
const CONNECTED_SITE_PATH = join(
    wsRoot, 'packages', 'core', 'src', 'schemas', 'connectedSite.js',
);

const BEGIN_MARKER = '<!-- BEGIN auto-generated glossary appendix -->';
const END_MARKER = '<!-- END auto-generated glossary appendix -->';

/**
 * Extract the `BridgeErrorCode` union members from index.ts.
 * The union is declared as `export type BridgeErrorCode = | 'X' | 'Y'`
 * across multiple lines; we pull each `'NAME'` literal until the
 * declaration ends with `;`.
 */
function extractBridgeErrorCodes(src) {
    const re = /export type BridgeErrorCode\s*=\s*([\s\S]*?);/m;
    const match = re.exec(src);
    if (!match) {
        throw new Error('BridgeErrorCode union not found in bridge-spec/src/index.ts');
    }
    const body = match[1];
    return [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

/**
 * Extract the SitePermissions keys from connectedSite.js. The shape
 * is documented in a JSDoc typedef block that lists `@property` lines.
 */
function extractSitePermissionKeys(src) {
    const re = /@typedef \{Object\} SitePermissions([\s\S]*?)\*\//m;
    const match = re.exec(src);
    if (!match) {
        throw new Error('SitePermissions typedef not found in connectedSite.js');
    }
    const body = match[1];
    const keys = [];
    for (const line of body.split('\n')) {
        const m = /@property \{[^}]+\}\s+(\w+)/.exec(line);
        if (m) keys.push(m[1]);
    }
    if (keys.length === 0) {
        throw new Error('SitePermissions typedef has no @property lines');
    }
    return keys;
}

function buildAppendix() {
    const bridgeSrc = readFileSync(BRIDGE_SPEC_PATH, 'utf8');
    const connSrc = readFileSync(CONNECTED_SITE_PATH, 'utf8');
    const codes = extractBridgeErrorCodes(bridgeSrc);
    const keys = extractSitePermissionKeys(connSrc);

    const lines = [];
    lines.push(BEGIN_MARKER);
    lines.push('');
    lines.push('## Appendix: Machine-derived terms');
    lines.push('');
    lines.push('The entries in this appendix are auto-generated from canonical');
    lines.push('source files. Do **not** edit by hand; run');
    lines.push('`node tools/glossary/generate-appendix.js` to refresh from source.');
    lines.push('Sources:');
    lines.push('');
    lines.push('- `packages/bridge-spec/src/index.ts`: `BridgeErrorCode` union');
    lines.push('- `packages/core/src/schemas/connectedSite.js`: `SitePermissions` keys');
    lines.push('');
    lines.push('### Bridge error codes');
    lines.push('');
    lines.push('Reasons a bridge call (connect / signMessage / signAction / signPsbt /');
    lines.push('signIn) can fail. dApps switch on `result.error` to choose the');
    lines.push('right user-facing copy.');
    lines.push('');
    for (const code of codes) {
        lines.push(`- \`${code}\``);
    }
    lines.push('');
    lines.push('### ConnectedSite permission keys');
    lines.push('');
    lines.push('Per-origin permissions surface; each key on a `ConnectedSite.permissions`');
    lines.push('record gates a bridge capability for that origin.');
    lines.push('');
    for (const key of keys) {
        lines.push(`- \`${key}\``);
    }
    lines.push('');
    lines.push(END_MARKER);
    return lines.join('\n');
}

function rewriteGlossary(currentSrc, appendix) {
    const beginIdx = currentSrc.indexOf(BEGIN_MARKER);
    const endIdx = currentSrc.indexOf(END_MARKER);
    if (beginIdx === -1 && endIdx === -1) {
        // Append a separator + the appendix at the end of the doc.
        const trimmed = currentSrc.replace(/\s+$/, '');
        return trimmed + '\n\n---\n\n' + appendix + '\n';
    }
    if (beginIdx === -1 || endIdx === -1) {
        throw new Error(
            'The glossary has only one of the auto-generated markers; please restore the pair manually before running the generator.',
        );
    }
    if (beginIdx >= endIdx) {
        throw new Error('The glossary has the auto-generated markers in the wrong order.');
    }
    const before = currentSrc.slice(0, beginIdx);
    const after = currentSrc.slice(endIdx + END_MARKER.length);
    return before + appendix + after;
}

function main() {
    const dryRun = process.argv.includes('--check');
    const appendix = buildAppendix();
    let current;
    try {
        current = readFileSync(GLOSSARY_PATH, 'utf8');
    } catch (err) {
        console.error(
            `cannot read the glossary at ${GLOSSARY_PATH}: ${err.message}\n`
            + 'The wallet glossary lives in the sibling xchain-documentation checkout\n'
            + '(components/wallet/glossary.md). Clone it beside this repo, or set\n'
            + 'GLOSSARY_PATH to your copy. Nothing was checked or written this run.',
        );
        return 2;
    }
    const next = rewriteGlossary(current, appendix);
    if (current === next) {
        console.log(`${GLOSSARY_PATH} already in sync.`);
        return 0;
    }
    if (dryRun) {
        console.error(
            `${GLOSSARY_PATH} is out of sync with source. Run `
                + '`node tools/glossary/generate-appendix.js` to refresh.',
        );
        return 1;
    }
    writeFileSync(GLOSSARY_PATH, next);
    console.log(`${GLOSSARY_PATH} updated.`);
    return 0;
}

const code = main();
process.exit(code);
