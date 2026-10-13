// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const productionRoots = [
    'packages/core/src',
    'packages/desktop/renderer',
    'packages/extension/src',
    'packages/web/public',
    'packages/web/src',
];

const files = execFileSync('git', ['ls-files', '--', ...productionRoots], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => /\.(?:css|html|js|jsx|mjs)$/.test(file));

function withoutComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
        .replace(/^\s*\/\/.*$/gm, '');
}

function lineAt(source, offset) {
    return source.slice(0, offset).split('\n').length;
}

function enclosingSupports(source, offset) {
    const stack = [];
    let segmentStart = 0;
    for (let i = 0; i < offset; i += 1) {
        if (source[i] === '{') {
            stack.push(source.slice(segmentStart, i).trim());
            segmentStart = i + 1;
        } else if (source[i] === '}') {
            stack.pop();
            segmentStart = i + 1;
        } else if (source[i] === ';') {
            segmentStart = i + 1;
        }
    }
    return stack.filter((header) => header.startsWith('@supports'));
}

function findAll(source, pattern) {
    return [...source.matchAll(pattern)].map((match) => ({
        index: match.index,
        text: match[0],
    }));
}

function inSupportsHeader(source, offset, guard) {
    const start = source.lastIndexOf('@supports', offset);
    if (start < 0) return false;
    const blockStart = source.indexOf('{', start);
    return blockStart > offset && guard.test(source.slice(start, blockStart));
}

const failures = [];
const jsFeatures = { structuredClone: 0, arrayAt: 0, objectHasOwn: 0 };

for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    const cssFeatures = [
        {
            name: 'dynamic viewport unit',
            pattern: /\b\d+(?:\.\d+)?(?:dvh|svh)\b/g,
            guard: /\(height:\s*100(?:dvh|svh)\)/,
        },
        {
            name: ':has()',
            pattern: /:has\s*\(/g,
            guard: /selector\s*\(\s*:has\s*\(/,
        },
        {
            name: 'container query',
            pattern: /@container\b|\bcontainer-type\s*:/g,
            guard: /\(container-type:\s*(?:inline-size|size)\)/,
        },
    ];

    for (const feature of cssFeatures) {
        for (const use of findAll(source, feature.pattern)) {
            const guards = enclosingSupports(source, use.index);
            if (!guards.some((guard) => feature.guard.test(guard))
                && !inSupportsHeader(source, use.index, feature.guard)) {
                failures.push(`${file}:${lineAt(source, use.index)} unguarded ${feature.name}: ${use.text}`);
            }
        }
    }

    const cloneUses = findAll(source, /\bstructuredClone\s*\(/g);
    jsFeatures.structuredClone += cloneUses.length;
    for (const use of cloneUses) {
        const before = source.slice(Math.max(0, use.index - 180), use.index);
        if (!/typeof\s+(?:globalThis\.)?structuredClone\s*===\s*['"]function['"]/.test(before)) {
            failures.push(`${file}:${lineAt(source, use.index)} unguarded structuredClone()`);
        }
    }

    jsFeatures.arrayAt += findAll(source, /\.at\s*\(/g).length;
    jsFeatures.objectHasOwn += findAll(source, /\bObject\.hasOwn\s*\(/g).length;
}

assert.deepEqual(failures, [], failures.join('\n'));

const vite = readFileSync('packages/web/vite.config.js', 'utf8');
const bootCheck = readFileSync('packages/web/public/boot-check.js', 'utf8');
const iosProject = readFileSync('packages/mobile/ios/App/App.xcodeproj/project.pbxproj', 'utf8');
assert.match(vite, /target:\s*['"]es2022['"]/, 'the JS feature audit requires the ES2022 build target');
assert.match(
    bootCheck,
    /typeof Object\.hasOwn !== 'function' \|\| typeof Array\.prototype\.at !== 'function'/,
    'the pre-bundle floor covers the ES2022 methods used by production code',
);
assert.doesNotMatch(iosProject, /IPHONEOS_DEPLOYMENT_TARGET = (?:1[0-5]|\d)\./,
    'the iOS target stays at 16 or newer');

console.log(
    `webview-compat smoke OK (${files.length} files; `
    + `${jsFeatures.structuredClone} structuredClone, ${jsFeatures.arrayAt} .at, `
    + `${jsFeatures.objectHasOwn} Object.hasOwn uses audited)`,
);
