// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';

import { cachedSourceFiles } from './sourceScan.js';

const COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const TOKEN_DECLARATION_PATTERN = /--xc-[\w-]+\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^;]+\))\s*;/gi;
const SHORT_HEX_PATTERN = /^#([0-9a-f]{3,4})$/;
const FUNCTIONAL_COLOR_PATTERN = /^(rgba?)\(([^)]+)\)$/;
const EXEMPTION = 'raw-color-ok:';

function stripComments(source) {
    return source.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '));
}

function maskVarFunctions(source) {
    const chars = [...source];
    for (let start = source.indexOf('var('); start !== -1; start = source.indexOf('var(', start + 1)) {
        let depth = 1;
        let end = start + 4;
        while (end < source.length && depth > 0) {
            if (source[end] === '(') depth += 1;
            else if (source[end] === ')') depth -= 1;
            end += 1;
        }
        if (depth !== 0) continue;
        for (let index = start; index < end; index += 1) {
            if (chars[index] !== '\n') chars[index] = ' ';
        }
        start = end - 1;
    }
    return chars.join('');
}

export function normalizeColor(value) {
    const compact = value.toLowerCase().replace(/\s+/g, '');
    const shortHex = compact.match(SHORT_HEX_PATTERN);
    if (shortHex) return `#${[...shortHex[1]].map((digit) => digit.repeat(2)).join('')}`;
    const functional = compact.match(FUNCTIONAL_COLOR_PATTERN);
    if (!functional) return compact;
    const channels = functional[2].split(',').map((channel) => {
        const numeric = Number(channel);
        return Number.isFinite(numeric) ? String(numeric) : channel;
    });
    return `${functional[1]}(${channels.join(',')})`;
}

export function readSharedCssSources(root) {
    const base = join(root, 'packages', 'core', 'src', 'shared');
    return cachedSourceFiles(base, '**/*.module.css').map((file) => ({
        path: join('packages', 'core', 'src', 'shared', file.relativePath),
        source: file.source,
    }));
}

export function findRawTokenColorViolations(tokenSource, files) {
    const tokenColors = new Set();
    const tokensWithoutComments = stripComments(tokenSource);
    for (const match of tokensWithoutComments.matchAll(TOKEN_DECLARATION_PATTERN)) {
        tokenColors.add(normalizeColor(match[1]));
    }

    const violations = [];
    for (const file of files) {
        const originalLines = file.source.split('\n');
        const sourceLines = maskVarFunctions(stripComments(file.source)).split('\n');
        sourceLines.forEach((line, index) => {
            const exempt = originalLines[index]?.includes(EXEMPTION)
                || originalLines[index - 1]?.includes(EXEMPTION);
            for (const match of line.matchAll(COLOR_PATTERN)) {
                const color = normalizeColor(match[0]);
                if (tokenColors.has(color) && !exempt) {
                    violations.push({ path: file.path, line: index + 1, color });
                }
            }
        });
    }
    return violations;
}
