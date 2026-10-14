// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Current offenders for merge coordination:
// - packages/core/src/shared/components/BalanceList.jsx
// - packages/core/src/shared/components/NetworkStatusIndicator.jsx
// - packages/core/src/shared/components/ReachabilityBanner.jsx
// - packages/core/src/shared/components/TokenField.jsx
// - packages/core/src/shared/routes/BridgeMoveForm.jsx
// - packages/core/src/shared/routes/DispenserExplorer.jsx
// - packages/core/src/shared/routes/DispenserForm.jsx
// - packages/core/src/shared/routes/Home.jsx
// - packages/core/src/shared/routes/ImportWallet.jsx
// - packages/core/src/shared/routes/MarketsList.jsx
// - packages/core/src/shared/routes/SweepForm.jsx
// - packages/core/src/shared/routes/TokenAdminForm.jsx
// - packages/core/src/shared/routes/TokenPicker.jsx
// - packages/extension/src/popup/App.jsx
// - packages/web/src/App.jsx

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_ROOTS = [
    resolve(ROOT, 'packages/core/src/shared/routes'),
    resolve(ROOT, 'packages/core/src/shared/components'),
    resolve(ROOT, 'packages/web/src'),
    resolve(ROOT, 'packages/extension/src/popup'),
];
const EXCLUDED_DIRECTORIES = new Set([
    resolve(ROOT, 'packages/core/src/shared/components/settings'),
    resolve(ROOT, 'packages/web/src/style-guide'),
]);
const BANNED_BANNERS = new Set(['NetworkBanner', 'DemoBanner']);

function jsxFiles(directory) {
    if (EXCLUDED_DIRECTORIES.has(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return jsxFiles(path);
        return entry.name.endsWith('.jsx') ? [path] : [];
    });
}

function visit(node, callback, parent = null) {
    if (!node || typeof node !== 'object') return;
    callback(node, parent);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, callback, node));
        else if (value?.type) visit(value, callback, node);
    }
}

function isNetworkKindReference(node) {
    if (node?.type === 'Identifier') return node.name === 'networkKind';
    if (node?.type !== 'MemberExpression' && node?.type !== 'OptionalMemberExpression') return false;
    if (!node.computed) return node.property?.type === 'Identifier' && node.property.name === 'networkKind';
    return node.property?.type === 'StringLiteral' && node.property.value === 'networkKind';
}

function outputsNetworkKind(node, taintedNames = new Set()) {
    if (!node) return false;
    if (isNetworkKindReference(node)) return true;
    if (node.type === 'Identifier' && taintedNames.has(node.name)) return true;

    if (node.type === 'TemplateLiteral') {
        return node.expressions.some((expression) => outputsNetworkKind(expression, taintedNames));
    }
    if (node.type === 'ConditionalExpression') {
        return outputsNetworkKind(node.consequent, taintedNames)
            || outputsNetworkKind(node.alternate, taintedNames);
    }
    if (node.type === 'LogicalExpression') {
        return node.operator === '&&'
            ? outputsNetworkKind(node.right, taintedNames)
            : outputsNetworkKind(node.left, taintedNames)
                || outputsNetworkKind(node.right, taintedNames);
    }
    if (node.type === 'BinaryExpression') {
        return node.operator === '+'
            && (outputsNetworkKind(node.left, taintedNames)
                || outputsNetworkKind(node.right, taintedNames));
    }
    if (node.type === 'SequenceExpression') {
        return outputsNetworkKind(node.expressions.at(-1), taintedNames);
    }
    if (node.type === 'ParenthesizedExpression' || node.type === 'ChainExpression') {
        return outputsNetworkKind(node.expression, taintedNames);
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        if (node.callee?.type === 'Identifier' && node.callee.name === 'String') {
            return node.arguments.some((argument) => outputsNetworkKind(argument, taintedNames));
        }
        if (node.callee?.type === 'MemberExpression' || node.callee?.type === 'OptionalMemberExpression') {
            return outputsNetworkKind(node.callee.object, taintedNames);
        }
    }
    return false;
}

function renderedNetworkKindNames(ast) {
    const declarations = [];
    visit(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
            declarations.push(node);
        }
    });

    const names = new Set();
    let added;
    do {
        added = false;
        for (const declaration of declarations) {
            if (!names.has(declaration.id.name) && outputsNetworkKind(declaration.init, names)) {
                names.add(declaration.id.name);
                added = true;
            }
        }
    } while (added);
    return names;
}

function importedBanner(node) {
    if (node.type !== 'ImportDeclaration') return null;
    const sourceName = node.source.value.match(/(?:^|\/)(NetworkBanner|DemoBanner)(?:\.jsx)?$/)?.[1];
    if (sourceName) return sourceName;
    for (const specifier of node.specifiers) {
        const importedName = specifier.imported?.name || specifier.local?.name;
        if (BANNED_BANNERS.has(importedName)) return importedName;
    }
    return null;
}

function violations(source, filename = 'fixture.jsx') {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const taintedNames = renderedNetworkKindNames(ast);
    const found = new Set();
    const record = (node, message) => found.add(`${filename}:${node.loc.start.line} ${message}`);

    visit(ast, (node, parent) => {
        const banner = importedBanner(node);
        if (banner) record(node, `imports ${banner}`);

        if (node.type === 'JSXAttribute' && node.name?.name === 'showNetworkKind') {
            record(node, 'passes showNetworkKind');
        }
        if (node.type === 'JSXExpressionContainer' && outputsNetworkKind(node.expression, taintedNames)) {
            const isChild = parent?.type === 'JSXElement' || parent?.type === 'JSXFragment';
            const isDisplayProp = parent?.type === 'JSXAttribute' && parent.name?.name !== 'networkKind';
            if (isChild || isDisplayProp) record(node, 'renders networkKind as text');
        }
        if (node.type === 'TemplateLiteral' && outputsNetworkKind(node)) {
            record(node, 'renders networkKind as text');
        }
    });
    return [...found];
}

describe('network label source guard', () => {
    it('detects rendered networkKind labels, banned banners, and the display prop', () => {
        const source = [
            "import { NetworkBanner } from './banners.js';",
            "import Demo from './DemoBanner.jsx';",
            'const suffix = ` on ${descriptor.networkKind}`;',
            'const direct = <span>{descriptor.networkKind}</span>;',
            'const fallback = <span>{networkKind || "mainnet"}</span>;',
            'const formatted = <span>{String(networkKind)}</span>;',
            'const control = <Picker showNetworkKind={false} />;',
            "const derived = enabled ? descriptor.networkKind : '';",
            'const derivedText = <span>{derived}</span>;',
        ].join('\n');

        expect(violations(source)).toEqual([
            'fixture.jsx:1 imports NetworkBanner',
            'fixture.jsx:2 imports DemoBanner',
            'fixture.jsx:3 renders networkKind as text',
            'fixture.jsx:4 renders networkKind as text',
            'fixture.jsx:5 renders networkKind as text',
            'fixture.jsx:6 renders networkKind as text',
            'fixture.jsx:7 passes showNetworkKind',
            'fixture.jsx:9 renders networkKind as text',
        ]);
    });

    it('permits networkKind comparisons and non-display data flow', () => {
        const source = [
            "const isMainnet = descriptor.networkKind === 'mainnet';",
            "const filtered = chains.filter((chain) => chain.networkKind !== 'regtest');",
            'const payload = buildPayload({ networkKind });',
            "const result = <span>{networkKind === 'mainnet' ? 'Live' : 'Development'}</span>;",
            'const payloadKind = networkKind;',
            'const share = <Share networkKind={payloadKind} />;',
        ].join('\n');

        expect(violations(source)).toEqual([]);
    });

    it('finds no network-kind labels or banned banner APIs in product JSX', () => {
        const found = SCAN_ROOTS.flatMap(jsxFiles).flatMap((file) => {
            const name = relative(ROOT, file);
            return violations(readFileSync(file, 'utf8'), name);
        });

        expect(found).toEqual([]);
    });
});
