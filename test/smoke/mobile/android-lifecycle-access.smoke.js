// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACTIVITY_LIFECYCLE_METHODS = [
    'onCreate',
    'onStart',
    'onResume',
    'onPause',
    'onStop',
    'onDestroy',
    'onNewIntent',
    'onActivityResult',
    'onRequestPermissionsResult',
    'onBackPressed',
];

const METHOD_PATTERN = ACTIVITY_LIFECYCLE_METHODS.join('|');

// Comments and literals are replaced with spaces so declaration offsets and
// line numbers stay intact without letting examples look like real methods.
function maskNonCode(source) {
    const chars = [...source];
    let state = 'code';

    const mask = (index) => {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
    };

    for (let i = 0; i < chars.length; i += 1) {
        const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
        const triple = `${pair}${chars[i + 2] ?? ''}`;

        if (state === 'code') {
            if (pair === '//') {
                mask(i);
                mask(i + 1);
                i += 1;
                state = 'line-comment';
            } else if (pair === '/*') {
                mask(i);
                mask(i + 1);
                i += 1;
                state = 'block-comment';
            } else if (triple === '\"\"\"') {
                mask(i);
                mask(i + 1);
                mask(i + 2);
                i += 2;
                state = 'triple-string';
            } else if (chars[i] === '\"' || chars[i] === "'") {
                const quote = chars[i];
                mask(i);
                state = quote === '\"' ? 'double-string' : 'single-string';
            }
            continue;
        }

        if (state === 'line-comment') {
            if (chars[i] === '\n') state = 'code';
            else mask(i);
            continue;
        }

        if (state === 'block-comment') {
            if (pair === '*/') {
                mask(i);
                mask(i + 1);
                i += 1;
                state = 'code';
            } else {
                mask(i);
            }
            continue;
        }

        if (state === 'triple-string') {
            if (triple === '\"\"\"') {
                mask(i);
                mask(i + 1);
                mask(i + 2);
                i += 2;
                state = 'code';
            } else {
                mask(i);
            }
            continue;
        }

        const quote = state === 'double-string' ? '\"' : "'";
        if (chars[i] === '\\') {
            mask(i);
            if (i + 1 < chars.length) {
                mask(i + 1);
                i += 1;
            }
        } else if (chars[i] === quote) {
            mask(i);
            state = 'code';
        } else {
            mask(i);
        }
    }

    return chars.join('');
}

function sourceLine(source, index) {
    return source.slice(0, index).split('\n').length;
}

export function parseLifecycleOverrides(source, extension) {
    const code = maskNonCode(source);
    const matches = [];
    const pattern = extension === '.kt'
        ? new RegExp(
            `(?<declaration>(?:(?:public|protected|private|internal|final|open|abstract|suspend|operator|infix|tailrec|external|inline)\\s+)*override\\s+fun\\s+(?:<[^>]+>\\s*)?(?<name>${METHOD_PATTERN})\\s*\\()`,
            'g',
        )
        : new RegExp(
            `@Override(?:\\s*\\([^)]*\\))?\\s+`
                + `(?<declaration>(?:@[\\w.]+(?:\\s*\\([^)]*\\))?\\s+)*`
                + `(?:(?:public|protected|private|final|synchronized|abstract|native|strictfp|static)\\s+)*`
                + `(?:[\\w$.[\\]<>?,]+\\s+)+(?<name>${METHOD_PATTERN})\\s*\\()`,
            'g',
        );

    for (const match of code.matchAll(pattern)) {
        const declaration = match.groups.declaration;
        const explicitAccess = /\b(public|protected|private|internal)\b/.exec(declaration)?.[1];
        matches.push({
            method: match.groups.name,
            access: explicitAccess ?? (extension === '.kt' ? 'public' : 'package-private'),
            line: sourceLine(code, match.index),
        });
    }
    return matches;
}

export function findWeakerLifecycleOverrides(source, extension, publicMethods) {
    return parseLifecycleOverrides(source, extension)
        .filter(({ method, access }) => publicMethods.has(method) && access !== 'public');
}

function sourceFilesUnder(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...sourceFilesUnder(path));
        else if (entry.isFile() && ['.java', '.kt'].includes(extname(entry.name))) files.push(path);
    }
    return files.sort();
}

function runSmoke() {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const bridgePath = join(
        root,
        'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java',
    );
    const bridgeSource = readFileSync(bridgePath, 'utf8');
    const bridgeOverrides = parseLifecycleOverrides(bridgeSource, '.java');
    const publicMethods = new Set(
        bridgeOverrides.filter(({ access }) => access === 'public').map(({ method }) => method),
    );

    assert.ok(publicMethods.has('onStart'),
        'failed to derive public onStart from Capacitor BridgeActivity');

    // These mutations prove the parser rejects weak access while leaving
    // framework-protected methods and Kotlin's implicit public access alone.
    assert.deepEqual(
        findWeakerLifecycleOverrides(`
            @Override protected void onStart() {}
            @Override protected void onCreate(Bundle state) {}
        `, '.java', publicMethods).map(({ method }) => method),
        ['onStart'],
    );
    assert.deepEqual(
        findWeakerLifecycleOverrides(`
            protected override fun onResume() {}
            protected override fun onNewIntent(intent: Intent) {}
            override fun onPause() {}
        `, '.kt', publicMethods).map(({ method }) => method),
        ['onResume'],
    );

    const sourceRoot = join(root, 'packages/mobile/android/app/src');
    const files = sourceFilesUnder(sourceRoot);
    const violations = files.flatMap((path) => findWeakerLifecycleOverrides(
        readFileSync(path, 'utf8'),
        extname(path),
        publicMethods,
    ).map(({ method, access, line }) => (
        `${relative(root, path)}:${line}: ${method} is ${access}, but Capacitor BridgeActivity declares it public`
    )));

    assert.deepEqual(violations, [], violations.join('\n'));
    console.log(
        `android-lifecycle-access smoke: ${files.length} sources checked against `
            + `${publicMethods.size} public BridgeActivity lifecycle methods`,
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) runSmoke();
