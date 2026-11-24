// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const screensDirectory = 'packages/mobile/ios/App/WatchApp/Screens';
const read = (name) => readFileSync(resolve(screensDirectory, name), 'utf8');

const manifest = {
    'BalancesScreen.swift': {
        'accessibilityLabel: headerLabel(),': 1,
        '.accessibilityLabel(Text(verbatim: requestLabel(model)))': 1,
        '.accessibilityLabel(Text(verbatim: controlLabel(key)))': 2,
        '.accessibilityLabel(Text(verbatim: rowLabel(index)))': 1,
        '.accessibilityLabel(Text(verbatim: rowLabel(item.index)))': 1,
        '.accessibilityLabel(Text(verbatim: accessibilityLabel))': 1,
        '.accessibilityLabel(Text(verbatim: controlLabel(control)))': 1,
    },
    'TokenDetailScreen.swift': {
        '.accessibilityLabel(Text(verbatim: identityLabel()))': 2,
        '.accessibilityLabel(Text(verbatim: amountLabel()))': 1,
        '.accessibilityLabel(Text(verbatim: controlLabel("w2.openOnPhone")))': 1,
        '.accessibilityLabel(Text(verbatim: factLabel(row)))': 1,
        '.accessibilityLabel(Text(verbatim: controlLabel(key)))': 1,
    },
    'AlertsScreen.swift': {
        '.accessibilityLabel(Text(verbatim: controlLabel("w3.empty")))': 1,
        '.accessibilityLabel(Text(verbatim: rowLabel(item)))': 1,
    },
    'AlertDetailScreen.swift': {
        '.accessibilityLabel(Text(verbatim: alertLabel(item)))': 1,
        '.accessibilityLabel(Text(verbatim: requestLabel(0)))': 1,
        '.accessibilityLabel(Text(verbatim: requestLabel(1)))': 1,
        '.accessibilityLabel(Text(verbatim: requestLabel(2)))': 2,
        '.accessibilityLabel(Text(verbatim: controlLabel("w4.openOnPhone")))': 1,
    },
};

const expectedLabelFunctions = {
    'BalancesScreen.swift': [
        'headerLabel', 'rowLabel', 'requestLabel', 'controlLabel', 'controlLabel',
    ],
    'TokenDetailScreen.swift': [
        'identityLabel', 'amountLabel', 'factLabel', 'controlLabel',
    ],
    'AlertsScreen.swift': ['rowLabel', 'controlLabel'],
    'AlertDetailScreen.swift': ['alertLabel', 'requestLabel', 'controlLabel'],
};

function occurrenceCount(source, value) {
    return source.split(value).length - 1;
}

function checkManifest(sources) {
    for (const [file, calls] of Object.entries(manifest)) {
        for (const [call, count] of Object.entries(calls)) {
            if (occurrenceCount(sources[file], call) !== count) {
                throw new Error(`${file} must contain ${count} occurrence(s) of ${call}`);
            }
        }
    }
}

function labelFunctionBodies(source) {
    const bodies = [];
    const signature = /func\s+(\w+Label)\s*\([^)]*\)[^{]*\{/g;
    for (const match of source.matchAll(signature)) {
        const open = match.index + match[0].lastIndexOf('{');
        let depth = 1;
        let end = open + 1;
        while (depth > 0 && end < source.length) {
            if (source[end] === '{') depth += 1;
            if (source[end] === '}') depth -= 1;
            end += 1;
        }
        if (depth !== 0) throw new Error(`Unclosed function ${match[1]}`);
        bodies.push({ name: match[1], body: source.slice(open + 1, end - 1) });
    }
    return bodies;
}

const sources = Object.fromEntries(Object.keys(manifest).map((file) => [file, read(file)]));

describe('Apple Watch accessibility modifier coverage', () => {
    it('matches every expected label attachment exactly', () => {
        expect(() => checkManifest(sources)).not.toThrow();
    });

    it('fails when any one expected attachment is deleted', () => {
        for (const [file, calls] of Object.entries(manifest)) {
            for (const call of Object.keys(calls)) {
                const changed = { ...sources, [file]: sources[file].replace(call, '') };
                expect(() => checkManifest(changed), `${file}: ${call}`).toThrow();
            }
        }
    });

    it('backs every screen label function with AccessibilityLabels', () => {
        for (const [file, expectedNames] of Object.entries(expectedLabelFunctions)) {
            const functions = labelFunctionBodies(sources[file]);
            expect(functions.map(({ name }) => name).sort()).toEqual([...expectedNames].sort());
            for (const { name, body } of functions) {
                expect(body, `${file}: ${name}`).toContain('AccessibilityLabels.');
            }
        }
    });
});
