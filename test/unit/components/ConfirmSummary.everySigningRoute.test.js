// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every surface that signs an action reaches the shared confirm screen
// through <ActionConfirmScreen>, and the confirm screen states what is being
// confirmed only from what the form tells it. This scan walks every shell's
// source and fails when a call site passes no summary, a summary that can be
// null, or one without its action verb, so a new signing form cannot reach
// the confirm screen with an empty hero.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PACKAGES = path.join(ROOT, 'packages');

// Call sites that are not a signing surface.
const NOT_SIGNING = new Set([
    // The style guide's live specimen of the screen, fed a fixture.
    'packages/web/src/style-guide/sections/ConfirmAndResultSections.jsx',
]);

// The only files allowed to render <ConfirmActionModal> themselves: the
// action adapter, and the message and PSBT variants, whose input is a text or
// a PSBT the wallet did not build rather than a composed action.
const MODAL_ADAPTERS = new Set([
    'packages/core/src/shared/components/ActionConfirmScreen.jsx',
    'packages/core/src/shared/components/MessageConfirmScreen.jsx',
    'packages/core/src/shared/components/PsbtConfirmScreen.jsx',
]);

function sourceFiles() {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
        }
    };
    for (const pkg of fs.readdirSync(PACKAGES)) {
        const src = path.join(PACKAGES, pkg, 'src');
        if (fs.existsSync(src)) walk(src);
    }
    return out.sort();
}

// Blank out comments and string or template text so a tag named in prose is
// not a call site, keeping every offset in place.
function stripComments(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const two = src.slice(i, i + 2);
        if (two === '//') {
            const end = src.indexOf('\n', i);
            const stop = end === -1 ? src.length : end;
            out += ' '.repeat(stop - i);
            i = stop;
        } else if (two === '/*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end === -1 ? src.length : end + 2;
            out += src.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
        } else {
            out += src[i];
            i += 1;
        }
    }
    return out;
}

// The text of a balanced {...} or (...) expression starting at `start`.
function balanced(src, start) {
    const open = src[start];
    const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : null;
    if (!close) return null;
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{' || c === '(' || c === '[') depth += 1;
        else if (c === '}' || c === ')' || c === ']') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return null;
}

// The opening tag of a JSX element starting at `start`, braces respected so
// an arrow function inside a prop does not end it.
function openingTag(src, start) {
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
}

// True when an object literal's own keys (not a nested object's) include `verb`.
function objectHasVerb(objectText) {
    let depth = 0;
    for (let i = 0; i < objectText.length; i += 1) {
        const c = objectText[i];
        if (c === '{' || c === '(' || c === '[') depth += 1;
        else if (c === '}' || c === ')' || c === ']') depth -= 1;
        else if (depth === 1 && /\bverb\s*:/y.test(objectText.slice(i, i + 40)) && /[\s,{]/.test(objectText[i - 1])) {
            return true;
        }
    }
    return false;
}

/**
 * Judge one summary={...} value. An inline object literal, or a name bound in
 * the same file to one (directly or through useMemo), must carry a verb. A
 * conditional, a null or a value built elsewhere does not pass. A name is
 * resolved to its last declaration above the tag, the one in scope there.
 */
function judgeSummary(expr, fileSrc, tagIndex) {
    const text = expr.trim();
    if (text.startsWith('{')) {
        return objectHasVerb(text) ? null : 'summary object has no verb';
    }
    const name = /^[A-Za-z_$][\w$]*$/.exec(text)?.[0];
    if (!name) return `summary is not an object literal or a named object (${text.slice(0, 60)})`;
    const decl = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*`, 'g');
    let body;
    let found = false;
    let match;
    while ((match = decl.exec(fileSrc)) && match.index < tagIndex) {
        found = true;
        let at = match.index + match[0].length;
        const memo = /^useMemo\(\s*\(\)\s*=>\s*\(/.exec(fileSrc.slice(at));
        if (memo) at += memo[0].length - 1;
        if (fileSrc[at] === '(') at += 1;
        body = fileSrc[at] === '{' ? balanced(fileSrc, at) : null;
    }
    if (!found) return `summary name ${name} is not declared above the call site`;
    if (!body) return `summary ${name} is not bound to an object literal`;
    if (!objectHasVerb(body)) return `summary ${name} has no verb`;
    return null;
}

function scan() {
    const sites = [];
    const strayModals = [];
    for (const file of sourceFiles()) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const raw = fs.readFileSync(file, 'utf8');
        if (!raw.includes('ConfirmActionModal') && !raw.includes('ActionConfirmScreen')) continue;
        const src = stripComments(raw);
        const lineOf = (index) => src.slice(0, index).split('\n').length;
        for (const m of src.matchAll(/<ConfirmActionModal\b/g)) {
            if (!MODAL_ADAPTERS.has(rel)) strayModals.push(`${rel}:${lineOf(m.index)}`);
        }
        if (NOT_SIGNING.has(rel)) continue;
        for (const m of src.matchAll(/<ActionConfirmScreen\b/g)) {
            const tag = openingTag(src, m.index);
            const prop = /\ssummary=\{/.exec(tag);
            let problem = null;
            if (!prop) {
                problem = 'no summary prop';
            } else {
                const value = balanced(tag, prop.index + prop[0].length - 1);
                problem = value ? judgeSummary(value.slice(1, -1), src, m.index) : 'summary prop does not close';
            }
            sites.push({ site: `${rel}:${lineOf(m.index)}`, problem });
        }
    }
    return { sites, strayModals };
}

describe('every signing route passes a confirm summary', () => {
    const { sites, strayModals } = scan();

    it('finds the signing call sites', () => {
        // A floor, so a scan that silently matches nothing cannot pass.
        expect(sites.length).toBeGreaterThan(50);
    });

    it('passes each <ActionConfirmScreen> a summary object with its verb', () => {
        const missing = sites.filter((s) => s.problem).map((s) => `${s.site}: ${s.problem}`);
        expect(missing).toEqual([]);
    });

    it('reaches <ConfirmActionModal> only through its adapters', () => {
        expect(strayModals).toEqual([]);
    });
});
