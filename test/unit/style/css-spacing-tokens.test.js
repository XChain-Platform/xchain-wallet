// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { cachedSourceFiles } from '../../helpers/sourceScan.js';

const CSS_ROOT = 'packages/core/src';
const SPACING_DECLARATION = /(?:^|[;{}])\s*((?:padding|margin)(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?|(?:row-|column-)?gap)\s*:\s*([^;{}]+)/gim;
const RAW_PX = /-?(?:\d+(?:\.\d+)?|\.\d+)px\b/gi;

const lineAt = (source, index) => source.slice(0, index).split('\n').length;

function scanCss(source, file, tokenValues) {
    const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    const offenders = [];

    for (const declaration of uncommented.matchAll(SPACING_DECLARATION)) {
        const [, property, value] = declaration;
        const valueOffset = declaration.index + declaration[0].lastIndexOf(value);
        for (const rawPx of value.matchAll(RAW_PX)) {
            const normalizedValue = rawPx[0].toLowerCase();
            if (!tokenValues.has(normalizedValue)) {
                offenders.push({
                    file,
                    line: lineAt(uncommented, valueOffset + rawPx.index),
                    property: property.toLowerCase(),
                    value: normalizedValue,
                });
            }
        }
    }

    return offenders;
}

function groupOffenders(offenders) {
    const groups = new Map();
    for (const offender of offenders) {
        const key = JSON.stringify([offender.file, offender.property, offender.value]);
        const group = groups.get(key) ?? { ...offender, lines: [] };
        delete group.line;
        group.lines.push(offender.line);
        groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const tokenSource = readFileSync(`${CSS_ROOT}/ui/tokens.css`, 'utf8');
const tokenValues = new Set(
    [...tokenSource.matchAll(/--xc-space-\d+\s*:\s*(-?(?:\d+(?:\.\d+)?|\.\d+)px)\s*;/gi)]
        .map((match) => match[1].toLowerCase()),
);
const baseline = JSON.parse(readFileSync('test/unit/style/css-spacing-baseline.json', 'utf8'));

it('recognizes off-scale raw pixel spacing values', () => {
    const source = `
        /* padding: 3px; */
        .example {
            padding: 4px 6px;
            margin-top: var(--xc-space-2);
            row-gap: 8px;
            column-gap: calc(12px + 1px);
        }
    `;

    expect(scanCss(source, 'example.module.css', tokenValues)).toEqual([
        { file: 'example.module.css', line: 4, property: 'padding', value: '6px' },
        { file: 'example.module.css', line: 7, property: 'column-gap', value: '1px' },
    ]);
});

it('does not increase the raw pixel spacing baseline', () => {
    const offenders = cachedSourceFiles(CSS_ROOT, '**/*.module.css')
        .flatMap(({ relativePath, source }) => scanCss(source, `${CSS_ROOT}/${relativePath}`, tokenValues));
    const current = groupOffenders(offenders);
    const baselineCounts = new Map(baseline.map((entry) => [
        JSON.stringify([entry.file, entry.property, entry.value]),
        entry.lines.length,
    ]));
    const regressions = current.filter((entry) => entry.lines.length > (
        baselineCounts.get(JSON.stringify([entry.file, entry.property, entry.value])) ?? 0
    ));

    expect(regressions, `New raw pixel spacing offenders:\n${JSON.stringify(regressions, null, 2)}`).toEqual([]);
    expect(offenders.length).toBeLessThanOrEqual(
        baseline.reduce((count, entry) => count + entry.lines.length, 0),
    );
});
