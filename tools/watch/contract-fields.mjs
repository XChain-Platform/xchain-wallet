// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function maskSource(source, { strings = true } = {}) {
    const chars = source.split('');
    let index = 0;

    const blank = (start, end) => {
        for (let cursor = start; cursor < end; cursor += 1) {
            if (chars[cursor] !== '\n' && chars[cursor] !== '\r') chars[cursor] = ' ';
        }
    };

    while (index < source.length) {
        if (source.startsWith('//', index)) {
            const end = source.indexOf('\n', index + 2);
            const stop = end === -1 ? source.length : end;
            blank(index, stop);
            index = stop;
            continue;
        }

        if (source.startsWith('/*', index)) {
            const start = index;
            let depth = 1;
            index += 2;
            while (index < source.length && depth > 0) {
                if (source.startsWith('/*', index)) {
                    depth += 1;
                    index += 2;
                } else if (source.startsWith('*/', index)) {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            blank(start, index);
            continue;
        }

        const tripleQuote = source.startsWith('"""', index);
        const quote = source[index];
        if (tripleQuote || quote === '"' || quote === '\'') {
            const start = index;
            const delimiter = tripleQuote ? '"""' : quote;
            index += delimiter.length;
            while (index < source.length) {
                if (source.startsWith(delimiter, index)) {
                    index += delimiter.length;
                    break;
                }
                if (!tripleQuote && source[index] === '\\') index += 2;
                else index += 1;
            }
            if (strings) blank(start, index);
            continue;
        }

        index += 1;
    }

    return chars.join('');
}

function matchingDelimiter(source, start, open, close) {
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === open) depth += 1;
        if (source[index] === close) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
}

function topLevelView(source, open = '{', close = '}') {
    const chars = source.split('');
    let depth = 0;

    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === open) {
            if (depth > 0) chars[index] = ' ';
            depth += 1;
        } else if (char === close) {
            depth -= 1;
            chars[index] = ' ';
        } else if (depth > 0 && char !== '\n' && char !== '\r') {
            chars[index] = ' ';
        }
    }

    return chars.join('');
}

function identifier(value) {
    return value.startsWith('`') ? value.slice(1, -1) : value;
}

function quotedValue(value) {
    const match = /"(?:\\.|[^"\\])*"/.exec(value);
    if (!match) return undefined;
    try {
        return JSON.parse(match[0]);
    } catch {
        return match[0].slice(1, -1);
    }
}

function splitTopLevel(source, masked = maskSource(source)) {
    const ranges = [];
    const depths = { '(': 0, '[': 0, '{': 0, '<': 0 };
    const pairs = { ')': '(', ']': '[', '}': '{', '>': '<' };
    let start = 0;

    for (let index = 0; index < masked.length; index += 1) {
        const char = masked[index];
        if (Object.hasOwn(depths, char)) depths[char] += 1;
        else if (Object.hasOwn(pairs, char) && depths[pairs[char]] > 0) depths[pairs[char]] -= 1;
        else if (char === ',' && Object.values(depths).every((depth) => depth === 0)) {
            ranges.push(source.slice(start, index));
            start = index + 1;
        }
    }
    ranges.push(source.slice(start));
    return ranges;
}

function swiftCodingKeyNames(body, maskedBody) {
    const topLevel = topLevelView(maskedBody);
    const declaration = /\benum\s+CodingKeys\b[^\{]*\{/.exec(topLevel);
    if (!declaration) return new Map();

    const open = declaration.index + declaration[0].lastIndexOf('{');
    const close = matchingDelimiter(maskedBody, open, '{', '}');
    if (close === -1) return new Map();

    const contents = body.slice(open + 1, close);
    const maskedContents = maskSource(contents);
    const visibleContents = topLevelView(maskedContents);
    const names = new Map();
    const cases = /(?:^|[;\n])\s*case\s+([^;\n]+)/g;

    for (const match of visibleContents.matchAll(cases)) {
        const captureOffset = match.index + match[0].indexOf(match[1]);
        const original = contents.slice(captureOffset, captureOffset + match[1].length);
        const masked = maskedContents.slice(captureOffset, captureOffset + match[1].length);
        for (const item of splitTopLevel(original, masked)) {
            const entry = /^\s*(`?[A-Za-z_][A-Za-z0-9_]*`?)\s*(?:=\s*([\s\S]+))?$/.exec(item);
            if (!entry) continue;
            const name = identifier(entry[1]);
            names.set(name, entry[2] === undefined ? name : (quotedValue(entry[2]) ?? name));
        }
    }

    return names;
}

function swiftStoredNames(body, maskedBody) {
    const topLevel = topLevelView(maskedBody);
    const names = [];
    const declaration = /(?:^|[;\n])\s*(?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\s*\([^)]*\))?|(?:public|private|fileprivate|internal|open|final|lazy|weak|unowned|nonisolated|isolated|override|required|convenience|dynamic|package|mutating|nonmutating)\b(?:\s*\([^)]*\))?)\s+)*(?:(static|class)\s+)?(?:let|var)\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)(?=\s|:|=|,|\{|$)([^;\n]*)/g;

    for (const match of topLevel.matchAll(declaration)) {
        if (match[1]) continue;
        const tail = match[3];
        const tailOffset = match.index + match[0].indexOf(match[3]);
        let braceOffset = tail.indexOf('{');
        if (braceOffset !== -1) braceOffset += tailOffset;
        else {
            const following = /^\s*\{/.exec(topLevel.slice(match.index + match[0].length));
            if (following) braceOffset = match.index + match[0].length + following[0].lastIndexOf('{');
        }
        if (braceOffset !== -1 && !topLevel.slice(tailOffset, braceOffset).includes('=')) {
            const bodyOffset = braceOffset + 1;
            if (!/^\s*(?:didSet|willSet)\b/.test(maskedBody.slice(bodyOffset))) continue;
        }

        names.push(identifier(match[2]));
        const originalTail = body.slice(tailOffset, tailOffset + tail.length);
        for (const item of splitTopLevel(originalTail, tail).slice(1)) {
            const extra = /^\s*(`?[A-Za-z_][A-Za-z0-9_]*`?)(?=\s|:|=|,|$)/.exec(item);
            if (extra) names.push(identifier(extra[1]));
        }
    }

    return names;
}

export function schemaFields(schema) {
    return Object.keys(schema?.properties ?? {}).sort();
}

export function swiftCodableFields(source) {
    const masked = maskSource(source);
    const fields = {};
    const declaration = /\b(?:struct|class)\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)(?:\s*<[^{}]*>)?\s*:\s*([^{}]+)\{/g;

    for (const match of masked.matchAll(declaration)) {
        if (!/\b(?:Codable|Decodable)\b/.test(match[2])) continue;
        const open = match.index + match[0].lastIndexOf('{');
        const close = matchingDelimiter(masked, open, '{', '}');
        if (close === -1) continue;
        const body = source.slice(open + 1, close);
        const maskedBody = masked.slice(open + 1, close);
        const codingKeys = swiftCodingKeyNames(body, maskedBody);
        fields[identifier(match[1])] = swiftStoredNames(body, maskedBody)
            .map((name) => codingKeys.get(name) ?? name)
            .sort();
    }

    return fields;
}

function kotlinConstructorStart(masked, start) {
    let index = start;

    const skipSpace = () => {
        while (/\s/.test(masked[index] ?? '')) index += 1;
    };

    skipSpace();
    if (masked[index] === '<') {
        const close = matchingDelimiter(masked, index, '<', '>');
        if (close === -1) return -1;
        index = close + 1;
    }

    while (index < masked.length) {
        skipSpace();
        if (masked[index] === '(') return index;
        if (masked[index] === '@') {
            index += 1;
            while (/[A-Za-z0-9_.:]/.test(masked[index] ?? '')) index += 1;
            skipSpace();
            if (masked[index] === '(') {
                const close = matchingDelimiter(masked, index, '(', ')');
                if (close === -1) return -1;
                index = close + 1;
            }
            continue;
        }

        const keyword = /^(?:public|private|internal|protected|constructor)\b/.exec(masked.slice(index));
        if (keyword) {
            index += keyword[0].length;
            continue;
        }
        return -1;
    }
    return -1;
}

export function kotlinSerialFields(source) {
    const masked = maskSource(source);
    const fields = {};
    const declaration = /@(?:kotlinx\.serialization\.)?Serializable\b(?:\s*\([^)]*\))?\s*(?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\s*\([^)]*\))?|(?:public|private|internal|protected|data|sealed|value|inner|open|abstract|final|expect|actual|annotation)\b)\s*)*class\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)/g;

    for (const match of masked.matchAll(declaration)) {
        const start = match.index + match[0].length;
        const open = kotlinConstructorStart(masked, start);
        const name = identifier(match[1]);
        if (open === -1) {
            fields[name] = [];
            continue;
        }
        const close = matchingDelimiter(masked, open, '(', ')');
        if (close === -1) continue;
        const contents = source.slice(open + 1, close);
        const maskedContents = masked.slice(open + 1, close);
        const names = [];

        for (const parameter of splitTopLevel(contents, maskedContents)) {
            const parameterMasked = maskSource(parameter);
            const property = /\b(?:val|var)\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)/.exec(parameterMasked);
            if (!property) continue;
            const commentFree = maskSource(parameter, { strings: false });
            const serialName = /@(?:kotlinx\.serialization\.)?SerialName\s*\(\s*(?:value\s*=\s*)?("(?:\\.|[^"\\])*")/.exec(commentFree);
            names.push(serialName ? (quotedValue(serialName[1]) ?? identifier(property[1])) : identifier(property[1]));
        }

        fields[name] = names.sort();
    }

    return fields;
}

export function contractParityFailures({ pairs, swiftSource, kotlinSource }) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
        throw new TypeError('pairs must be a non-empty array');
    }
    for (const pair of pairs) {
        if (typeof pair?.type !== 'string' || pair.type.trim().length === 0) {
            throw new TypeError('each pair type must be a non-empty string');
        }
        if (pair.schema === null || typeof pair.schema !== 'object' || Array.isArray(pair.schema)) {
            throw new TypeError('each pair schema must be an object');
        }
    }
    if (typeof swiftSource !== 'string') throw new TypeError('swiftSource must be a string');
    if (typeof kotlinSource !== 'string') throw new TypeError('kotlinSource must be a string');

    const platformFields = [
        ['swift', swiftCodableFields(swiftSource)],
        ['kotlin', kotlinSerialFields(kotlinSource)],
    ];
    const failures = [];

    for (const { type, schema } of pairs) {
        const expected = schemaFields(schema);
        for (const [platform, types] of platformFields) {
            if (!Object.hasOwn(types, type)) {
                failures.push(`${platform}:${type}:absent`);
                continue;
            }

            const actual = new Set(types[type]);
            const expectedSet = new Set(expected);
            for (const field of expected) {
                if (!actual.has(field)) failures.push(`${platform}:${type}:missing:${field}`);
            }
            for (const field of [...actual].sort()) {
                if (!expectedSet.has(field)) failures.push(`${platform}:${type}:extra:${field}`);
            }
        }
    }

    return failures;
}
