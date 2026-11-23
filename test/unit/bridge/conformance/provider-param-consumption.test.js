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

const NOT_HONOURED = {
    SignActionParams: {
        feeStrategyHint: 'Deprecated because pages cannot choose bridge action fees.',
    },
    SignMessageParams: {
        displayLabel: 'Cosmetic display hint is not rendered by the wallet.',
    },
};

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
    for (const interfaceName of Object.keys(NOT_HONOURED)) {
        it(`accounts for every ${interfaceName} field`, () => {
            const fields = interfaceFields(interfaceName);
            const unread = fields.filter((field) => !isReadByHandler(field));
            const allowlisted = Object.keys(NOT_HONOURED[interfaceName]).sort();

            expect(unread).toEqual(allowlisted);
            for (const field of allowlisted) expect(isReadByHandler(field), field).toBe(false);
        });
    }

    it('marks ignored SignActionParams fields as deprecated', () => {
        const body = interfaceBody('SignActionParams');
        for (const field of Object.keys(NOT_HONOURED.SignActionParams)) {
            const docs = body.match(new RegExp(`/\\*\\*([\\s\\S]*?)\\*/\\s*${field}\\??:`));
            expect(docs, `${field} has a documentation block`).not.toBeNull();
            expect(docs[1], field).toContain('@deprecated');
        }
    });
});
