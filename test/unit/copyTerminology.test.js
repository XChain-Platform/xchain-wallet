// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;
const sources = import.meta.glob(
    [
        '../../packages/core/src/shared/**/*.{js,jsx}',
        '../../packages/core/src/i18n/locales/en/index.js',
    ],
    { query: '?raw', import: 'default', eager: true },
);

const FORBIDDEN_COPY = [
    /\bseed phrases?\b/i,
    /\bbackup words?\b/i,
    /\bminer fees?\b/i,
    /\bwallet addresses?\b/i,
    /^fee:$/i,
];

function normalized(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function visibleTerminologyIn(source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const entries = [];
    const record = (node, value) => {
        const copy = normalized(value);
        if (!copy) return;
        const usesDisplayMnemonic = /\bmnemonic\b/i.test(copy)
            && (/\s/.test(copy) || copy === 'Mnemonic');
        if (!usesDisplayMnemonic && !FORBIDDEN_COPY.some((pattern) => pattern.test(copy))) return;
        entries.push({ line: node.loc.start.line, copy });
    };

    traverse(ast, {
        StringLiteral(path) {
            // Keep invisible search aliases available for legacy terminology queries.
            if (path.parent.type === 'ObjectProperty'
                && path.parent.key.type === 'Identifier'
                && path.parent.key.name === 'keywords') return;
            record(path.node, path.node.value);
        },
        JSXText(path) { record(path.node, path.node.value); },
        TemplateElement(path) { record(path.node, path.node.value.cooked); },
    });
    return entries;
}

describe('user-facing terminology', () => {
    it('uses the glossary terms throughout shared copy and the English locale', () => {
        const failures = Object.entries(sources).flatMap(([file, source]) => (
            visibleTerminologyIn(source).map(({ line, copy }) => `${file}:${line}: ${copy}`)
        ));

        expect(failures).toEqual([]);
    });
});
