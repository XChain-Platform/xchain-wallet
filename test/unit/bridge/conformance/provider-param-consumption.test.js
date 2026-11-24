// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeSpecSource = readFileSync(
    join(process.cwd(), 'packages/connect/src/index.ts'),
    'utf8',
);
const handlersSource = readFileSync(
    join(process.cwd(), 'packages/extension/src/bridge/handlers.js'),
    'utf8',
);
const executableHandlerSource = handlersSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const PARAM_INTERFACES = ['SignActionParams', 'SignMessageParams'];

function interfaceBody(name) {
    const match = bridgeSpecSource.match(
        new RegExp(`export interface ${name}[^\\{]*\\{([\\s\\S]*?)\\n\\}`),
    );
    expect(match, `${name} interface is present`).not.toBeNull();
    return match[1];
}

function interfaceFields(name) {
    return [...interfaceBody(name).matchAll(/^ {4}(\w+)\??:/gm)]
        .map((match) => match[1])
        .sort();
}

function isReadByHandler(field) {
    return new RegExp(`(?:\\.|\\?\\.)${field}\\b`).test(executableHandlerSource);
}

describe('provider parameter consumption', () => {
    for (const interfaceName of PARAM_INTERFACES) {
        it(`accounts for every ${interfaceName} field`, () => {
            const fields = interfaceFields(interfaceName);
            const unread = fields.filter((field) => !isReadByHandler(field));

            expect(unread).toEqual([]);
        });
    }
});
