// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = [
    'packages/core/src/shared',
    'packages/core/src/ui',
];

const SAFARI_LIST_COMMENT = 'Safari needs an explicit list role because this class removes list styling.';

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

function attribute(openingElement, name) {
    return openingElement.attributes.find((item) => (
        item.type === 'JSXAttribute' && item.name?.name === name
    ));
}

function attributeValue(node) {
    if (!node?.value) return null;
    if (node.value.type === 'StringLiteral') return node.value.value;
    if (node.value.type === 'JSXExpressionContainer' && node.value.expression.type === 'StringLiteral') {
        return node.value.expression.value;
    }
    return null;
}

function auditNativeRoles(source, filename = 'fixture.jsx') {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const issues = [];

    function report(node, message) {
        issues.push(`${filename}:${node.loc.start.line}: ${message}`);
    }

    function visit(node) {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier') {
            const element = node.name.name;
            const roleNode = attribute(node, 'role');
            const role = attributeValue(roleNode);

            if (element === 'button' && role === 'button') {
                report(roleNode, 'button repeats its native button role');
            }
            if (element === 'a' && attribute(node, 'href') && role === 'link') {
                report(roleNode, 'anchor repeats its native link role');
            }
            if (/^h[1-6]$/.test(element) && role === 'heading') {
                report(roleNode, 'heading repeats its native heading role');
            }
            if (element === 'svg' && role === 'img'
                && !attribute(node, 'aria-label') && !attribute(node, 'aria-labelledby')) {
                report(roleNode, 'SVG image role has no accessible label');
            }
            if (element === 'ul' && role === 'list') {
                const prefix = source.slice(Math.max(0, node.start - 220), node.start).trimEnd();
                const plainComment = `/* ${SAFARI_LIST_COMMENT} */`;
                const jsxComment = `{${plainComment}}`;
                if (!prefix.endsWith(plainComment) && !prefix.endsWith(jsxComment)) {
                    report(roleNode, 'list role has no Safari list-style explanation');
                }
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'loc' || key === 'start' || key === 'end') continue;
            if (Array.isArray(value)) value.forEach(visit);
            else visit(value);
        }
    }

    visit(ast);
    return issues;
}

describe('native role audit', () => {
    it('detects redundant roles, unlabeled SVG roles, and unexplained list restoration', () => {
        const source = `
            export function Fixture() {
                return <>
                    <button role="button">Save</button>
                    <a href="/help" role="link">Help</a>
                    <h2 role="heading">Title</h2>
                    <ul role="list"><li>One</li></ul>
                    <svg role="img"><path /></svg>
                </>;
            }
        `;

        expect(auditNativeRoles(source)).toEqual([
            'fixture.jsx:4: button repeats its native button role',
            'fixture.jsx:5: anchor repeats its native link role',
            'fixture.jsx:6: heading repeats its native heading role',
            'fixture.jsx:7: list role has no Safari list-style explanation',
            'fixture.jsx:8: SVG image role has no accessible label',
        ]);
    });

    it('accepts labeled SVGs and documented Safari list restoration', () => {
        const source = `
            export function Fixture() {
                return <>
                    {/* ${SAFARI_LIST_COMMENT} */}
                    <ul role="list"><li>One</li></ul>
                    <svg role="img" aria-label="Price history"><path /></svg>
                </>;
            }
        `;

        expect(auditNativeRoles(source)).toEqual([]);
    });

    it('finds no invalid native role overrides in shared and UI sources', () => {
        const issues = SOURCE_ROOTS.flatMap((root) => {
            const absoluteRoot = resolve(process.cwd(), root);
            return sourceFiles(absoluteRoot).flatMap((filename) => (
                auditNativeRoles(readFileSync(filename, 'utf8'), relative(process.cwd(), filename))
            ));
        });

        expect(issues).toEqual([]);
    });
});
