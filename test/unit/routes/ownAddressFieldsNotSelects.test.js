// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'packages/core/src');

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.jsx$/.test(entry.name) ? [path] : [];
    });
}

// A Select whose options print a wallet address is an own-address field
// built as a dropdown; those fields open the own-address picker instead.
function addressSelects(source) {
    return [...source.matchAll(/<Select\b[\s\S]*?<\/Select>/g)].filter((match) => (
        [...match[0].matchAll(/<option\b[\s\S]*?<\/option>/g)]
            .some((option) => /\.address\b|truncateAddress\(/.test(option[0]))
    ));
}

describe('own-address fields', () => {
    it('never list the wallet addresses in a Select', () => {
        const offenders = sourceFiles(sourceRoot).flatMap((path) => {
            const source = readFileSync(path, 'utf8');
            return addressSelects(source).map((match) => (
                `${relative(sourceRoot, path)}:${source.slice(0, match.index).split('\n').length}`
            ));
        });

        expect(offenders).toEqual([]);
    });

    it('recognises an address Select', () => {
        const sample = '<Select label="From address">{list.map((a) => (<option key={a.id} value={a.id}>{a.address}</option>))}</Select>';
        expect(addressSelects(sample)).toHaveLength(1);
        expect(addressSelects('<Select label="Action"><option value="send">Send</option></Select>')).toHaveLength(0);
    });
});
