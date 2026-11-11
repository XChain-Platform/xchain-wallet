// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

import { cachedSourceFiles } from '../../helpers/sourceScan.js';

const sources = cachedSourceFiles('packages', '**/*.jsx');
const traverse = _traverse.default || _traverse;

function selectorTags() {
    return sources.flatMap(({ relativePath, source }) => (
        [...source.matchAll(/<FeeSelector\b[\s\S]*?\/>/g)]
            .map((match) => ({ file: relativePath, tag: match[0] }))
    ));
}

describe('FeeSelector call sites', () => {
    it('supplies a chain and leaves fiat and availability ownership to FeeSelector', () => {
        const violations = [];
        for (const { file, tag } of selectorTags()) {
            if (!/\bchainId\s*=/.test(tag)) violations.push(`${file}: missing chainId`);
            if (/\bformatFiat\s*=/.test(tag)) violations.push(`${file}: carries formatFiat`);
            if (/\bshowEstimateNotice\s*=/.test(tag)) violations.push(`${file}: carries showEstimateNotice`);
        }
        expect(violations).toEqual([]);
    });

    it('keeps the retired fee-service notice out of packages', () => {
        const offenders = sources
            .filter(({ source }) => source.includes('Live fee estimate unavailable'))
            .map(({ relativePath }) => relativePath);
        expect(offenders).toEqual([]);
    });

    it('binds identifier-based chain props in their component scope', () => {
        const unbound = [];
        for (const { relativePath, source } of sources) {
            if (!source.includes('<FeeSelector')) continue;
            const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
            traverse(ast, {
                JSXOpeningElement(path) {
                    if (path.node.name.type !== 'JSXIdentifier' || path.node.name.name !== 'FeeSelector') return;
                    const attribute = path.node.attributes.find((candidate) => (
                        candidate.type === 'JSXAttribute'
                        && candidate.name.name === 'chainId'
                    ));
                    const expression = attribute?.value?.type === 'JSXExpressionContainer'
                        ? attribute.value.expression
                        : null;
                    if (expression?.type === 'Identifier' && !path.scope.hasBinding(expression.name)) {
                        unbound.push(`${relativePath}: ${expression.name}`);
                    }
                },
            });
        }
        expect(unbound).toEqual([]);
    });
});
