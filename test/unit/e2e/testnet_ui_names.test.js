// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const E2E = path.join(ROOT, 'test/e2e');
const CORE_SRC = path.join(ROOT, 'packages/core/src');

export const COMPOSED = {
    'Open Validator stake': ['Open ', 'Validator stake'],
    'Switch to Testnet?': ['Switch to {network}?', 'Testnet'],
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
});

const methodName = (call) => {
    const { callee } = call;
    if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') return null;
    if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name;
    if (callee.computed && callee.property.type === 'StringLiteral') return callee.property.value;
    return null;
};

const roleName = (call) => {
    const options = call.arguments[1];
    if (options?.type !== 'ObjectExpression') return null;
    const property = options.properties.find((candidate) => candidate.type === 'ObjectProperty'
        && ((candidate.key.type === 'Identifier' && candidate.key.name === 'name')
            || (candidate.key.type === 'StringLiteral' && candidate.key.value === 'name')));
    return property?.value?.type === 'StringLiteral' ? property.value : null;
};

export function collectUiNames(source) {
    const found = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
            const method = methodName(node);
            const literal = method === 'getByRole'
                ? roleName(node)
                : (method === 'getByLabel' || method === 'getByTestId')
                    && node.arguments[0]?.type === 'StringLiteral'
                    ? node.arguments[0]
                    : null;
            if (literal) found.push({ kind: method, line: literal.loc.start.line, text: literal.value });
        }
        Object.values(node).forEach(visit);
    };
    visit(parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] }));
    return found;
}

const targets = () => [
    ...walk(path.join(E2E, 'tests')).filter((file) => file.endsWith('.testnet.spec.js')),
    ...fs.readdirSync(path.join(E2E, 'fixtures'))
        .filter((file) => /^testnet.*\.js$/.test(file))
        .map((file) => path.join(E2E, 'fixtures', file)),
];

const coreSources = () => walk(CORE_SRC).map((file) => fs.readFileSync(file, 'utf8'));

export function invalidUiNames(files, sources, composed = COMPOSED) {
    const failures = new Set();
    for (const [name, source] of files) {
        for (const { line, text } of collectUiNames(source)) {
            if (Object.hasOwn(composed, text)) {
                for (const fragment of composed[text]) {
                    if (!sources.some((candidate) => candidate.includes(fragment))) {
                        failures.add(`COMPOSED ${JSON.stringify(text)} missing fragment ${JSON.stringify(fragment)}`);
                    }
                }
            } else if (!sources.some((candidate) => candidate.includes(text))) {
                failures.add(`${name}:${line} ${JSON.stringify(text)}`);
            }
        }
    }
    return [...failures];
}

describe('testnet e2e UI name literals', () => {
    it('lets only the live testnet wallets unlock without mainnet balances', () => {
        const fixture = fs.readFileSync(path.join(E2E, 'fixtures/wallet.js'), 'utf8');
        const expectedOptOuts = [
            'tests/staking/partial-claim.testnet.spec.js',
            'tests/staking/stake-unstake.testnet.spec.js',
        ];
        const optOuts = walk(path.join(E2E, 'tests'))
            .filter((file) => file.endsWith('.spec.js'))
            .filter((file) => fs.readFileSync(file, 'utf8').match(
                /createWallet\(page,\s*\{[^}]*waitForBalances:\s*false/s,
            ))
            .map((file) => path.relative(E2E, file))
            .sort();

        expect(fixture).toContain('bip39Passphrase = null, waitForBalances = true,');
        expect(fixture).toContain('waitForBalances ? unlockedShell(page) : unlockedAnyScreen(page)');
        expect(fixture).toContain('acknowledgeDonationNotice(page, ads, { waitForBalances })');
        expect(optOuts).toEqual(expectedOptOuts);
    });

    it('reports unknown and incomplete composed names while skipping non-literals', () => {
        const sample = [
            "page.getByRole('button', { name: 'known role' });",
            "page.getByLabel('planted unknown name');",
            "page.getByTestId('known test id');",
            "page.getByRole('button', { name: /regex name/i });",
            'page.getByRole(\'button\', { name: `template ${name}` });',
            "page.getByRole('button', { name: new RegExp('constructed name') });",
            "page.getByRole('listitem', { name: 'composed name' });",
        ].join('\n');
        expect(collectUiNames(sample)).toEqual([
            { kind: 'getByRole', line: 1, text: 'known role' },
            { kind: 'getByLabel', line: 2, text: 'planted unknown name' },
            { kind: 'getByTestId', line: 3, text: 'known test id' },
            { kind: 'getByRole', line: 7, text: 'composed name' },
        ]);
        expect(invalidUiNames(
            [['sample.js', sample]],
            ['known role', 'known test id', 'present fragment'],
            { 'composed name': ['present fragment', 'missing fragment'] },
        )).toEqual([
            'sample.js:2 "planted unknown name"',
            'COMPOSED "composed name" missing fragment "missing fragment"',
        ]);
    });

    it('accepts the testnet switch dialog and the switch network button', () => {
        const sample = [
            "page.getByRole('dialog', { name: 'Switch to Testnet?' });",
            "page.getByRole('button', { name: 'Switch network' });",
        ].join('\n');
        expect(invalidUiNames([['sample.js', sample]], coreSources())).toEqual([]);
    });

    it('finds every locator kind and every literal in packages/core/src', () => {
        const files = targets().map((file) => [path.relative(ROOT, file), fs.readFileSync(file, 'utf8')]);
        const names = files.flatMap(([, source]) => collectUiNames(source));
        for (const kind of ['getByRole', 'getByLabel', 'getByTestId']) {
            expect(names.some((name) => name.kind === kind), `scan found no ${kind} literal`).toBe(true);
        }
        expect(invalidUiNames(files, coreSources())).toEqual([]);
    });
});
