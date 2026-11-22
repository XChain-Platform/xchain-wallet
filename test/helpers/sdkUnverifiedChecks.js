// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every "Could not verify" check id the installed SDK's pre-flight source can
// emit, read from the source itself so the wallet's copy map and settle-time
// list are judged against what ships rather than against a hand-kept list.
//
// Files are read with readFileSync, never grep: context.js carries NUL bytes,
// which grep and ripgrep treat as binary and skip, and that file emits the
// token and balance lookups.

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { requireSdkDeep, resolveSdkDeep } from './sdkDeepPaths.js';

const EMIT_CALL = /\b(?:ctx|this)\.(?:addUnverified|fetch|noteStaleBalance)\(\s*([^,)]+)/g;

/**
 * Ids built at run time, keyed by '<file under src/preflight>|<expression>'.
 * A dynamic site missing here fails the scan by name, so a new run-time id
 * gets a human look instead of slipping past the gate.
 */
const DYNAMIC_SITES = {
    // checkMisc declares `<ACTION>_STATE` for every action with a non-null note.
    "checks/misc.js|action + '_STATE'": (load) => Object.entries(load('checks/misc.js').ASPECT_NOTES)
        .filter(([, note]) => note !== null)
        .map(([action]) => `${action}_STATE`),
    'checks/misc.js|entry.code': (load) => {
        const table = load('checks/misc.js').VOTE_ASPECT_NOTES;
        if (!table) throw new Error('checks/misc.js emits entry.code but no longer exports VOTE_ASPECT_NOTES');
        return Object.values(table).map((entry) => entry.code);
    },
    "checks/trading.js|noun + '_REFERENCE'": () => ['ORDER_REFERENCE', 'SWAP_REFERENCE'],
    "checks/trading.js|noun + '_RESTRICTIONS'": () => ['ORDER_RESTRICTIONS', 'SWAP_RESTRICTIONS'],
    // Parameter pass-throughs inside the context: every caller's literal is
    // collected at its own call site.
    'context.js|checkName': () => [],
    'context.js|check': () => [],
};

function listJsFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listJsFiles(path));
        else if (entry.name.endsWith('.js')) out.push(path);
    }
    return out;
}

/**
 * Scan the installed SDK's src/preflight tree for unverified check ids.
 *
 * @returns {{ ids: Set<string>, sites: number }} ids, and how many call sites fed them
 * @throws naming every FINDING_CODES member that does not resolve and every
 *   dynamic site this helper does not know how to expand
 */
export function sdkUnverifiedCheckIds() {
    const constantsFile = resolveSdkDeep('preflightConstants').filename;
    const root = dirname(constantsFile);
    const { FINDING_CODES } = requireSdkDeep('preflightConstants');
    const requireFromRoot = createRequire(constantsFile);
    const load = (rel) => requireFromRoot(`./${rel}`);
    const ids = new Set();
    const problems = [];
    let sites = 0;
    for (const file of listJsFiles(root)) {
        const rel = relative(root, file).split(sep).join('/');
        for (const m of readFileSync(file, 'utf8').matchAll(EMIT_CALL)) {
            sites += 1;
            const expr = m[1].trim();
            const literal = expr.match(/^(['"])([A-Z0-9_]+)\1$/);
            const constant = expr.match(/^FINDING_CODES\.(\w+)$/);
            if (literal) ids.add(literal[2]);
            else if (constant && FINDING_CODES[constant[1]]) ids.add(FINDING_CODES[constant[1]]);
            else if (constant) problems.push(`${rel}: FINDING_CODES.${constant[1]} is not registered`);
            else if (DYNAMIC_SITES[`${rel}|${expr}`]) for (const id of DYNAMIC_SITES[`${rel}|${expr}`](load)) ids.add(id);
            else problems.push(`${rel}: unknown run-time check id "${expr}"`);
        }
    }
    if (problems.length) throw new Error(`unverified-check scan needs a look:\n${problems.join('\n')}`);
    return { ids, sites };
}
