// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceRoot = join(root, 'packages/core/src');
// Forms whose chain comes from a record (a contract, a token's callback
// chain), so their From picker keeps to that chain and hides the switch.
const fixedChainHosts = [
    'shared/routes/CallbackForm.jsx',
    'shared/routes/ContractFundsForm.jsx',
    'shared/routes/ContractStakeForm.jsx',
    'shared/routes/ExecuteContractForm.jsx',
];

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.jsx$/.test(entry.name) ? [path] : [];
    });
}

function pickerUsages() {
    return sourceFiles(sourceRoot).flatMap((path) => {
        const rel = relative(sourceRoot, path).replaceAll('\\', '/');
        const source = readFileSync(path, 'utf8');
        return [...source.matchAll(/<OwnAddressPickerScreen\b[\s\S]*?\/>/g)].map((match) => ({
            rel,
            at: `${rel}:${source.slice(0, match.index).split('\n').length}`,
            switches: /\bonChainChange=\{/.test(match[0]),
            locked: /\blockNetwork\b/.test(match[0]),
        }));
    });
}

describe('own-address picker chain changes', () => {
    it('either follows a cross-chain pick or keeps the picker on the form chain', () => {
        const offenders = pickerUsages()
            .filter((usage) => usage.switches === usage.locked)
            .map((usage) => usage.at);

        expect(offenders).toEqual([]);
    });

    it('locks the picker on every fixed-chain form', () => {
        const usages = pickerUsages();
        for (const rel of fixedChainHosts) {
            const own = usages.filter((usage) => usage.rel === rel);
            expect(own.length, rel).toBeGreaterThan(0);
            expect(own.every((usage) => usage.locked && !usage.switches), rel).toBe(true);
        }
    });
});
