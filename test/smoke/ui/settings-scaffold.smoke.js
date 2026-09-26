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
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { discoverUsedAddresses } from '../../../packages/core/src/flows/discoverUsedAddresses.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const shellRoots = new Map(
    ['desktop', 'extension', 'mobile', 'web']
        .map((name) => [name, resolve(repoRoot, 'packages', name)]),
);

export function createMessagingHostStub(handlers = {}) {
    const calls = [];
    const host = {
        async request(method, ...args) {
            calls.push({ method, args });
            const handler = handlers[method];
            if (typeof handler !== 'function') {
                throw new Error(`Unstubbed host method: ${method}`);
            }
            return handler(...args);
        },
    };
    const messaging = new Proxy(Object.create(null), {
        get(_target, property) {
            if (property === 'then' || typeof property !== 'string') return undefined;
            return (...args) => host.request(property, ...args);
        },
    });
    return { calls, host, messaging };
}

function importsFrom(source, filename) {
    const ast = parse(source, {
        sourceType: 'module',
        plugins: ['jsx', 'importAttributes'],
        sourceFilename: filename,
    });
    const imports = [];
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (
            (value.type === 'ImportDeclaration'
                || value.type === 'ExportNamedDeclaration'
                || value.type === 'ExportAllDeclaration')
            && typeof value.source?.value === 'string'
        ) {
            imports.push(value.source.value);
        }
        if (
            value.type === 'CallExpression'
            && (value.callee?.type === 'Import'
                || (value.callee?.type === 'Identifier' && value.callee.name === 'require'))
            && typeof value.arguments?.[0]?.value === 'string'
        ) {
            imports.push(value.arguments[0].value);
        }
        for (const child of Object.values(value)) {
            if (Array.isArray(child)) child.forEach(visit);
            else visit(child);
        }
    };
    visit(ast.program);
    return imports;
}

function importedShell(filename, specifier) {
    for (const [name, root] of shellRoots) {
        if (specifier === `@xchain-wallet/${name}` || specifier.startsWith(`@xchain-wallet/${name}/`)) {
            return name;
        }
        if (specifier.startsWith('.')) {
            const target = resolve(dirname(filename), specifier);
            if (target === root || target.startsWith(`${root}${sep}`)) return name;
        }
    }
    return null;
}

function coreShellImportViolations() {
    const output = execFileSync(
        'git',
        ['ls-files', '-z', 'packages/core/src'],
        { cwd: repoRoot, encoding: 'utf8' },
    );
    const files = output.split('\0').filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    const violations = [];
    for (const file of files) {
        const absolute = resolve(repoRoot, file);
        for (const specifier of importsFrom(readFileSync(absolute, 'utf8'), file)) {
            const shell = importedShell(absolute, specifier);
            if (shell) violations.push(`${file} imports ${shell} shell via ${specifier}`);
        }
    }
    return violations;
}

async function testMessagingHostStub() {
    const stub = createMessagingHostStub({
        echo: (value) => ({ value }),
    });
    assert.deepEqual(await stub.messaging.echo('message'), { value: 'message' });
    assert.deepEqual(await stub.host.request('echo', 'host'), { value: 'host' });
    assert.deepEqual(stub.calls, [
        { method: 'echo', args: ['message'] },
        { method: 'echo', args: ['host'] },
    ]);
    await assert.rejects(stub.messaging.missing(), /Unstubbed host method: missing/);
}

async function testAddressDiscovery() {
    const descriptor = {
        id: 'bitcoin-mainnet',
        defaultAddressType: 'p2wpkh',
        addressTypes: ['p2wpkh'],
    };
    const chainRegistry = {
        supportedChains: () => [descriptor],
        get: (chainId) => (chainId === descriptor.id ? descriptor : undefined),
        derivationPathFor: (_chainId, _addressType, account, change, index) => (
            `m/84'/0'/${account}'/${change}/${index}`
        ),
    };
    const sdkRegistry = {
        get: () => ({ wallet: { deriveAddress: (publicKey) => `address-${publicKey}` } }),
    };
    let probes = 0;
    const result = await discoverUsedAddresses({
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        chainRegistry,
        sdkRegistry,
        gapLimit: 2,
        isUsedProbe: async () => ({ used: probes++ === 0 }),
    });
    assert.equal(result.totalUsedFound, 1);
    assert.equal(result.perChain.length, 1);
    assert.equal(result.perChain[0].highestUsedIndex, 0);
    assert.equal(result.perChain[0].scannedCount, 3);
    assert.equal(result.perChain[0].incomplete, false);
    assert.deepEqual(result.perChain[0].addresses.map(({ index, used, unknown }) => (
        { index, used, unknown }
    )), [
        { index: 0, used: true, unknown: false },
        { index: 1, used: false, unknown: false },
        { index: 2, used: false, unknown: false },
    ]);
}

async function main() {
    await testMessagingHostStub();
    await testAddressDiscovery();
    assert.equal(
        importedShell(
            resolve(repoRoot, 'packages/core/src/example.js'),
            '../../extension/src/background.js',
        ),
        'extension',
    );
    assert.equal(
        importedShell(resolve(repoRoot, 'packages/core/src/example.js'), '@xchain-wallet/web'),
        'web',
    );
    assert.deepEqual(
        coreShellImportViolations(),
        [],
        'packages/core/src must never import a desktop, extension, mobile, or web shell',
    );
    console.log('settings-scaffold custody smoke OK');
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
    await main();
}
