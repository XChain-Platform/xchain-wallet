// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectories = [
    'packages/extension/src/popup',
    'packages/extension/src/approval',
];
const excludedComponents = new Set([
    'Router.jsx',
    'ConnectApproval.jsx',
    'SignApproval.jsx',
]);
const nativeControlPattern = /<(?:button|input|select|textarea)\b/;

function jsxFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return jsxFiles(path);
        if (!entry.name.endsWith('.jsx') || excludedComponents.has(entry.name)) return [];
        return [path];
    });
}

describe('extension popup and approval kit controls', () => {
    const files = sourceDirectories.flatMap((directory) => jsxFiles(resolve(directory)));

    it.each(files)('%s has no hand-rolled form controls', (file) => {
        const source = readFileSync(file, 'utf8');

        expect(source).not.toMatch(nativeControlPattern);
    });

    it.each(['button', 'input', 'select', 'textarea'])('rejects a native %s control', (tag) => {
        expect(`<${tag} aria-label="fixture" />`).toMatch(nativeControlPattern);
    });

    it('renders the popup recovery action with the core Button', () => {
        const file = files.find((candidate) => basename(candidate) === 'backgroundConnection.jsx');
        const source = readFileSync(file, 'utf8');

        expect(source).toMatch(/import \{ Button \} from '@xchain-wallet\/core\/ui'/);
        expect(source).toMatch(/<Button\b[^>]*\bonClick=\{reload\}/);
    });
});
