// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared helper for smokes that assert on the Actions menu.
//
// The menu used to be declared three times, once per shell App.jsx, so a
// smoke could ask "does this shell list the dispenser entry?" by grepping
// that shell's source. There is now ONE declaration, in
// packages/core/src/shared/actionEntries.js, and a shell decides only
// whether to arm an entry by passing its handler. So the question splits
// in two, and a smoke should ask both halves:
//
//   declaresEntry(id)          the menu knows about this entry at all
//   armsEntry(appSrc, handler) this shell wires it to one of its routes
//
// Asking only the first would pass for a shell that never wires the entry;
// asking only the second would pass for a handler the menu ignores.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ACTION_ENTRIES_PATH = fileURLToPath(
    new URL('../../packages/core/src/shared/actionEntries.js', import.meta.url),
);

/** Raw source of the shared menu, for smokes that want their own regex. */
export const actionEntriesSrc = readFileSync(ACTION_ENTRIES_PATH, 'utf8');

/**
 * Entry defs parsed out of the shared module, by id.
 * @type {Map<string, { id: string, handler: string, label: string, description: string }>}
 */
export const actionEntries = new Map();

// The module is a flat array of object literals with four known keys, so a
// scan is enough and keeps the helper free of a parser dependency. Reading
// it as source (rather than importing it) is deliberate: these are smokes,
// and they run under plain node with no bundler alias for @xchain-wallet/*.
const DEF_RE = /\{\s*id:\s*'([^']+)',\s*handler:\s*'([^']+)',\s*label:\s*'((?:[^'\\]|\\.)*)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*\}/g;
for (const m of actionEntriesSrc.matchAll(DEF_RE)) {
    actionEntries.set(m[1], {
        id: m[1],
        handler: m[2],
        label: m[3].replace(/\\'/g, "'"),
        description: m[4].replace(/\\'/g, "'"),
    });
}

if (actionEntries.size === 0) {
    throw new Error(
        `${ACTION_ENTRIES_PATH}: parsed zero entries. The shared menu changed shape; `
        + 'fix this helper rather than letting every menu smoke pass vacuously.',
    );
}

/** Does the shared menu declare this entry id? */
export function declaresEntry(id) {
    return actionEntries.has(id);
}

/** Label the shared menu gives this entry ('' when it declares no such id). */
export function entryLabel(id) {
    return actionEntries.get(id)?.label ?? '';
}

/** Description the shared menu gives this entry ('' when unknown). */
export function entryDescription(id) {
    return actionEntries.get(id)?.description ?? '';
}

/** Handler prop name that arms this entry ('' when unknown). */
export function entryHandler(id) {
    return actionEntries.get(id)?.handler ?? '';
}

/**
 * Both halves at once: the shared menu declares this entry (under the
 * expected label, when one is given) AND this shell arms it.
 *
 * @param {string} appSrc         Shell App.jsx source.
 * @param {string} id             Entry id.
 * @param {string} [expectedLabel] Label the caller expects to see rendered.
 */

/**
 * Does this shell arm the entry, i.e. pass a real handler for it?
 *
 * A shell may gate an entry on a capability
 * (`onMultisigCreate: hasBtcAddress ? fn : undefined`), which still counts
 * as armed: the menu filters the unarmed case out at runtime. A handler
 * whose value is the bare literal `undefined` does not count.
 *
 * @param {string} appSrc  Shell App.jsx source.
 * @param {string} id      Entry id, or the handler name itself.
 */
export function surfacesEntry(appSrc, id, expectedLabel) {
    if (!actionEntries.has(id)) return false;
    if (expectedLabel !== undefined && entryLabel(id) !== expectedLabel) return false;
    return armsEntry(appSrc, id);
}

export function armsEntry(appSrc, id) {
    const handler = actionEntries.has(id) ? actionEntries.get(id).handler : id;
    if (!handler) return false;
    const m = appSrc.match(new RegExp(`\\b${handler}:\\s*([^\\n]*)`));
    if (!m) return false;
    return !/^undefined\s*,?\s*$/.test(m[1].trim());
}
