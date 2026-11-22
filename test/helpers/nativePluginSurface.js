// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

function withoutComments(source) {
    let result = '';
    let quote = null;

    for (let index = 0; index < source.length;) {
        const current = source[index];
        const next = source[index + 1];

        if (quote !== null) {
            result += current;
            if (current === '\\') {
                result += next ?? '';
                index += 2;
                continue;
            }
            if (current === quote) quote = null;
            index += 1;
            continue;
        }

        if (current === '"' || current === "'" || current === '`') {
            quote = current;
            result += current;
            index += 1;
            continue;
        }

        if (current === '/' && next === '/') {
            result += '  ';
            index += 2;
            while (index < source.length && source[index] !== '\n') {
                result += ' ';
                index += 1;
            }
            continue;
        }

        if (current === '/' && next === '*') {
            result += '  ';
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
                result += source[index] === '\n' ? '\n' : ' ';
                index += 1;
            }
            if (index < source.length) {
                result += '  ';
                index += 2;
            }
            continue;
        }

        result += current;
        index += 1;
    }

    return result;
}

function firstCapture(source, pattern) {
    return pattern.exec(source)?.[1] ?? null;
}

function captures(source, pattern) {
    return [...source.matchAll(pattern)].map((match) => match[1]);
}

export function swiftPluginSurface(source) {
    const code = withoutComments(source);
    return {
        identifier: firstCapture(code, /\blet\s+identifier\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/),
        jsName: firstCapture(code, /\blet\s+jsName\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/),
        methods: captures(
            code,
            /\bCAPPluginMethod\s*\(\s*name\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
        ),
    };
}

export function javaPluginSurface(source) {
    const code = withoutComments(source);
    return {
        name: firstCapture(
            code,
            /@CapacitorPlugin\s*\(\s*name\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
        ),
        methods: captures(
            code,
            /@PluginMethod(?:\s*\([^)]*\))?\s+public\s+void\s+([A-Za-z_$][\w$]*)\s*\(/g,
        ),
    };
}
