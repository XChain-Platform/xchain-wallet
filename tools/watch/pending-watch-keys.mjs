// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { isInvokedDirectly } from '../release/is-invoked-directly.mjs';

function readString(source, start) {
    const quote = source[start];
    let index = start + 1;
    let value = '';

    while (index < source.length) {
        const character = source[index];
        index += 1;
        if (character === quote) return { value, next: index };
        if (character !== '\\') {
            value += character;
            continue;
        }
        if (index >= source.length) return null;

        const escaped = source[index];
        index += 1;
        if (escaped === '\n') continue;
        if (escaped === '\r') {
            if (source[index] === '\n') index += 1;
            continue;
        }

        const simpleEscapes = {
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
            v: '\v',
            0: '\0',
        };
        if (Object.hasOwn(simpleEscapes, escaped)) {
            value += simpleEscapes[escaped];
            continue;
        }

        if (escaped === 'x') {
            const digits = source.slice(index, index + 2);
            if (!/^[\da-f]{2}$/i.test(digits)) return null;
            value += String.fromCodePoint(Number.parseInt(digits, 16));
            index += 2;
            continue;
        }

        if (escaped === 'u') {
            if (source[index] === '{') {
                const end = source.indexOf('}', index + 1);
                const digits = source.slice(index + 1, end);
                if (end === -1 || !/^[\da-f]{1,6}$/i.test(digits)) return null;
                const codePoint = Number.parseInt(digits, 16);
                if (codePoint > 0x10ffff) return null;
                value += String.fromCodePoint(codePoint);
                index = end + 1;
                continue;
            }

            const digits = source.slice(index, index + 4);
            if (!/^[\da-f]{4}$/i.test(digits)) return null;
            value += String.fromCodePoint(Number.parseInt(digits, 16));
            index += 4;
            continue;
        }

        value += escaped;
    }

    return null;
}

function tokens(source) {
    const result = [];
    let index = 0;

    while (index < source.length) {
        const character = source[index];
        if (/\s/.test(character)) {
            index += 1;
            continue;
        }

        if (source.startsWith('//', index)) {
            const end = source.indexOf('\n', index + 2);
            index = end === -1 ? source.length : end + 1;
            continue;
        }
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            index = end === -1 ? source.length : end + 2;
            continue;
        }

        if (character === '"' || character === "'") {
            const string = readString(source, index);
            if (!string) break;
            result.push({ type: 'string', value: string.value });
            index = string.next;
            continue;
        }

        if (character === '`') {
            index += 1;
            while (index < source.length) {
                if (source[index] === '\\') {
                    index += 2;
                } else if (source[index] === '`') {
                    index += 1;
                    break;
                } else {
                    index += 1;
                }
            }
            continue;
        }

        if (/[A-Za-z_$]/.test(character)) {
            const start = index;
            index += 1;
            while (/[\w$]/.test(source[index] ?? '')) index += 1;
            result.push({ type: 'identifier', value: source.slice(start, index) });
            continue;
        }

        result.push({ type: 'punctuation', value: character });
        index += 1;
    }

    return result;
}

function parseObject(allTokens, start) {
    const entries = [];
    let index = start + 1;

    while (allTokens[index]?.value !== '}') {
        const key = allTokens[index];
        if (key?.type !== 'string' && key?.type !== 'identifier') return null;
        if (allTokens[index + 1]?.value !== ':') return null;
        const row = allTokens[index + 2];
        if (row?.type !== 'string') return null;
        entries.push({ key: key.value, row: row.value });
        index += 3;

        if (allTokens[index]?.value === ',') {
            index += 1;
        } else if (allTokens[index]?.value !== '}') {
            return null;
        }
    }

    return entries;
}

function parseMap(allTokens, start) {
    if (
        allTokens[start]?.value !== 'new'
        || allTokens[start + 1]?.value !== 'Map'
        || allTokens[start + 2]?.value !== '('
        || allTokens[start + 3]?.value !== '['
    ) return null;

    const entries = [];
    let index = start + 4;
    while (allTokens[index]?.value !== ']') {
        if (allTokens[index]?.value !== '[') return null;
        const key = allTokens[index + 1];
        const row = allTokens[index + 3];
        if (
            key?.type !== 'string'
            || allTokens[index + 2]?.value !== ','
            || row?.type !== 'string'
            || allTokens[index + 4]?.value !== ']'
        ) return null;

        entries.push({ key: key.value, row: row.value });
        index += 5;
        if (allTokens[index]?.value === ',') {
            index += 1;
        } else if (allTokens[index]?.value !== ']') {
            return null;
        }
    }

    return allTokens[index + 1]?.value === ')' ? entries : null;
}

export function readPendingWatchKeys(source) {
    const allTokens = tokens(source);
    for (let index = 0; index < allTokens.length; index += 1) {
        if (
            allTokens[index]?.type !== 'identifier'
            || allTokens[index]?.value !== 'pendingWatchKeys'
            || allTokens[index + 1]?.value !== '='
        ) continue;

        const valueIndex = index + 2;
        const parsed = allTokens[valueIndex]?.value === '{'
            ? parseObject(allTokens, valueIndex)
            : parseMap(allTokens, valueIndex);
        if (parsed) return parsed;
    }

    return [];
}

if (isInvokedDirectly(import.meta.url)) {
    const filePath = process.argv[2] ?? 'test/unit/i18n.test.js';
    const pending = readPendingWatchKeys(readFileSync(filePath, 'utf8'));
    if (pending.length > 0) {
        process.stdout.write(`${pending.map(({ key, row }) => `${key} ${row}`).join('\n')}\n`);
        process.exitCode = 1;
    }
}
