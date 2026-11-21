// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const USAGE = `Usage: node tools/release/gradle-pins.mjs --help

Reads Gradle ext assignments supplied by an importing release check.
Reports version pins that are not exact numeric releases without changing files.
`;

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[\w$]/;
const ASSIGNMENT = /(?:^|[;\r\n])\s*([A-Za-z_$][\w$]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^;\r\n}]*?))\s*(?=;|[\r\n}]|$)/g;
const RELEASE = /^\d+(?:\.\d+)*$/;

function withoutComments(text) {
    let result = '';
    let quote = '';
    let escaped = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            result += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
            result += char;
        } else if (char === '/' && text[i + 1] === '/') {
            result += '  ';
            i += 1;
            while (i + 1 < text.length && !/[\r\n]/.test(text[i + 1])) {
                result += ' ';
                i += 1;
            }
        } else if (char === '/' && text[i + 1] === '*') {
            result += '  ';
            i += 1;
            while (i + 1 < text.length) {
                if (text[i + 1] === '*' && text[i + 2] === '/') {
                    result += '  ';
                    i += 2;
                    break;
                }
                result += /[\r\n]/.test(text[i + 1]) ? text[i + 1] : ' ';
                i += 1;
            }
        } else {
            result += char;
        }
    }
    return result;
}

function extBody(text) {
    for (let i = 0; i < text.length;) {
        if (text[i] === '"' || text[i] === "'") {
            const quote = text[i];
            for (i += 1; i < text.length; i += 1) {
                if (text[i] === '\\') i += 1;
                else if (text[i] === quote) { i += 1; break; }
            }
            continue;
        }
        if (!IDENTIFIER_START.test(text[i])) {
            i += 1;
            continue;
        }

        const start = i;
        while (i < text.length && IDENTIFIER_PART.test(text[i])) i += 1;
        if (text.slice(start, i) !== 'ext') continue;
        while (/\s/.test(text[i])) i += 1;
        if (text[i] !== '{') continue;

        const bodyStart = i + 1;
        let depth = 1;
        let quote = '';
        let escaped = false;
        for (i = bodyStart; i < text.length; i += 1) {
            const char = text[i];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = '';
            } else if (char === '"' || char === "'") quote = char;
            else if (char === '{') depth += 1;
            else if (char === '}' && --depth === 0) return text.slice(bodyStart, i);
        }
        return text.slice(bodyStart);
    }
    return '';
}

export function readGradleExt(text) {
    const entries = [];
    for (const match of extBody(withoutComments(text)).matchAll(ASSIGNMENT)) {
        entries.push([match[1], match[2] ?? match[3] ?? match[4].trim()]);
    }
    return Object.fromEntries(entries);
}

export function badVersionPins(vars, { prefix = '' } = {}) {
    return Object.keys(vars)
        .filter((key) => key.startsWith(prefix) && key.endsWith('Version') && !RELEASE.test(vars[key]))
        .map((key) => ({ key, value: vars[key] }));
}

if (isInvokedDirectly(import.meta.url)
    && process.argv.length === 3
    && (process.argv[2] === '--help' || process.argv[2] === '-h')) {
    process.stdout.write(USAGE);
}
