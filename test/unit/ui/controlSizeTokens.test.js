// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTROL_SIZE_LITERAL_ALLOWLIST } from './controlSizeTokens.allowlist.js';

const moduleRoot = path.join(process.cwd(), 'packages/core/src');
const forbiddenDeclaration = /(?:^|[;{])\s*(height|min-height):\s*(28|30|32|34|36|38|44|48)px(?:\s*!important)?\s*;/g;

function moduleCssFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return moduleCssFiles(entryPath);
        return entry.name.endsWith('.module.css') ? [entryPath] : [];
    });
}

function keyOf({ file, selector, property, value }) {
    return `${file} | ${selector} | ${property}: ${value}`;
}

function literalControlSizes() {
    return moduleCssFiles(moduleRoot).flatMap((filePath) => {
        const relativeFile = path.relative(moduleRoot, filePath).split(path.sep).join('/');
        const source = fs.readFileSync(filePath, 'utf8').replace(
            /\/\*[\s\S]*?\*\//g,
            (comment) => comment.replace(/[^\n]/g, ' '),
        );
        const lines = source.split('\n');

        return lines.flatMap((line, lineIndex) => {
            return [...line.matchAll(forbiddenDeclaration)].map((match) => {
                const sameLinePrefix = line.slice(0, match.index + 1);
                const sameLineBrace = sameLinePrefix.lastIndexOf('{');
                let selector;
                if (sameLineBrace >= 0) {
                    selector = sameLinePrefix.slice(0, sameLineBrace).trim();
                } else {
                    let selectorLine = lineIndex - 1;
                    while (selectorLine >= 0 && !lines[selectorLine].includes('{')) selectorLine -= 1;
                    selector = lines[selectorLine]?.split('{')[0].trim();
                }
                return {
                    file: relativeFile,
                    selector,
                    property: match[1],
                    value: `${match[2]}px`,
                };
            });
        });
    });
}

describe('shared control size tokens', () => {
    it('rejects new literal control-sized heights in core CSS modules', () => {
        for (const exception of CONTROL_SIZE_LITERAL_ALLOWLIST) {
            expect(exception.reason, keyOf(exception)).toBeTruthy();
        }

        const actual = literalControlSizes().map(keyOf).sort();
        const allowed = CONTROL_SIZE_LITERAL_ALLOWLIST.map(keyOf).sort();
        expect(actual).toEqual(allowed);
    });
});
