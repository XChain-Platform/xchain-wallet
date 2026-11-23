// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) {
            for (const child of value) walk(child, visit);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
            walk(value, visit);
        }
    }
}

function jsxName(node) {
    return node?.type === 'JSXIdentifier' ? node.name : null;
}

function propertyName(node) {
    if (node?.computed) return null;
    if (node?.key?.type === 'Identifier' || node?.key?.type === 'StringLiteral') {
        return node.key.name ?? node.key.value;
    }
    return null;
}

function addHit(hits, filename, node, kind) {
    hits.push({
        filename,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        kind,
    });
}

export function findNoticeVariantSites(source, filename = 'source.jsx') {
    const ast = parse(source, {
        sourceType: 'unambiguous',
        sourceFilename: filename,
        plugins: ['jsx', 'typescript', 'importAttributes'],
    });
    const hits = [];
    walk(ast, (node) => {
        if (node.type !== 'JSXOpeningElement') return;
        const name = jsxName(node.name);
        if (name === 'Notice' || name === 'StatusMessage') {
            const variant = node.attributes.find((attribute) => (
                attribute.type === 'JSXAttribute' && jsxName(attribute.name) === 'variant'
            ));
            if (variant) addHit(hits, filename, node, 'variant prop');
        }
        if (name !== 'StatusMessageGroup') return;
        const entries = node.attributes.find((attribute) => (
            attribute.type === 'JSXAttribute' && jsxName(attribute.name) === 'entries'
        ));
        const value = entries?.value?.type === 'JSXExpressionContainer'
            ? entries.value.expression
            : null;
        if (value?.type !== 'ArrayExpression') return;
        for (const entry of value.elements) {
            if (entry?.type !== 'ObjectExpression') continue;
            for (const property of entry.properties) {
                if (property.type === 'ObjectProperty' && propertyName(property) === 'variant') {
                    addHit(hits, filename, property, 'variant entry key');
                }
            }
        }
    });
    return hits;
}

export function formatNoticeVariantSite(hit) {
    return `${hit.filename}:${hit.line}:${hit.column}: ${hit.kind}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('usage: notice-variant-sites.mjs <files...>');
        process.exitCode = 2;
    } else {
        const hits = files.flatMap((filename) => findNoticeVariantSites(
            readFileSync(filename, 'utf8'),
            filename,
        ));
        for (const hit of hits) console.error(formatNoticeVariantSite(hit));
        if (hits.length > 0) process.exitCode = 1;
    }
}
