// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob([
    '../../packages/core/src/shared/**/*.{js,jsx,cjs,mjs}',
    '../../packages/web/src/**/*.{js,jsx,cjs,mjs}',
    '../../packages/extension/src/**/*.{js,jsx,cjs,mjs}',
    '../../packages/desktop/**/*.{js,jsx,cjs,mjs}',
    '!../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'importAssertions',
    'topLevelAwait',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
];

// These identifiers are supplied by the JavaScript, browser, extension, or
// CommonJS runtime rather than by a lexical declaration in the source file.
const RUNTIME_GLOBALS = new Set([
    '__dirname', 'AbortController', 'AbortSignal', 'arguments', 'Array',
    'ArrayBuffer', 'atob', 'Audio', 'BigInt', 'Blob', 'Boolean', 'btoa',
    'Buffer', 'cancelAnimationFrame', 'chrome', 'clearInterval', 'clearTimeout',
    'ClipboardItem', 'console', 'crypto', 'CustomEvent', 'Date',
    'decodeURIComponent', 'document', 'DOMException', 'encodeURIComponent', 'Error', 'Event',
    'fetch', 'File', 'FileReader', 'getComputedStyle', 'globalThis', 'HTMLElement', 'Image',
    'Infinity', 'Intl', 'isFinite', 'JSON', 'localStorage', 'location', 'Map',
    'Math', 'module', 'MutationObserver', 'NaN', 'navigator', 'Notification',
    'Number', 'Object', 'parseFloat', 'parseInt', 'process', 'Promise', 'Proxy',
    'queueMicrotask', 'Reflect', 'RegExp', 'Request', 'requestAnimationFrame', 'require',
    'ResizeObserver', 'sessionStorage', 'Set', 'setImmediate', 'setInterval',
    'setTimeout', 'String', 'Symbol', 'TextDecoder', 'TextEncoder', 'TypeError',
    'Uint8Array', 'undefined', 'unescape', 'URL', 'URLSearchParams', 'WeakMap',
    'WeakSet', 'window',
]);

const STANDARD_HOOKS = new Set([
    'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect',
    'useId', 'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect',
    'useMemo', 'useReducer', 'useRef', 'useState', 'useSyncExternalStore',
    'useTransition',
]);

function scan(code) {
    const ast = parse(code, {
        sourceType: 'module',
        plugins: PARSER_PLUGINS,
        errorRecovery: true,
    });
    const findings = {
        syntax: ast.errors.map((error) => `${error.reasonCode}: ${error.message}`),
        unbound: [],
        duplicateImports: [],
        duplicateHooks: [],
    };
    if (findings.syntax.length > 0) return findings;

    const imports = new Map();
    const hooksByScope = new WeakMap();
    traverse(ast, {
        ReferencedIdentifier(path) {
            const { name } = path.node;
            if (RUNTIME_GLOBALS.has(name) || path.scope.getBinding(name)) return;
            findings.unbound.push(`${name} (line ${path.node.loc?.start.line})`);
        },
        ImportDeclaration(path) {
            for (const specifier of path.node.specifiers) {
                const imported = specifier.type === 'ImportSpecifier'
                    ? specifier.imported.name || specifier.imported.value
                    : specifier.type;
                const key = `${path.node.source.value}:${imported}`;
                if (imports.has(key)) {
                    findings.duplicateImports.push(
                        `${key} (lines ${imports.get(key)}, ${specifier.loc?.start.line})`,
                    );
                } else {
                    imports.set(key, specifier.loc?.start.line);
                }
            }
        },
        CallExpression(path) {
            const callee = path.get('callee');
            if (!callee.isIdentifier() || !/^use[A-Z]/.test(callee.node.name)) return;
            if (STANDARD_HOOKS.has(callee.node.name)) return;

            const scopeNode = path.getFunctionParent()?.node || path.scope.getProgramParent().path.node;
            let hooks = hooksByScope.get(scopeNode);
            if (!hooks) {
                hooks = new Map();
                hooksByScope.set(scopeNode, hooks);
            }
            const call = code.slice(path.node.start, path.node.end).replace(/\s+/g, ' ');
            const key = callee.node.name === 'useBackHandler'
                ? callee.node.name
                : `${callee.node.name}:${call}`;
            if (hooks.has(key)) {
                findings.duplicateHooks.push(
                    `${callee.node.name} (lines ${hooks.get(key)}, ${path.node.loc?.start.line})`,
                );
            } else {
                hooks.set(key, path.node.loc?.start.line);
            }
        },
    });
    return findings;
}

const display = (key) => key.replace(/^(\.\.\/)+/, '');
const entries = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b));

describe('merged source has no duplicate or undeclared bindings', () => {
    it('detects each guarded residue pattern', () => {
        const findings = scan(`
            import { value as first } from 'example';
            import { value as second } from 'example';
            function Screen() {
                missingRef.current = 1;
                setMissing('value');
                useBackHandler(first);
                useBackHandler(second);
            }
        `);
        expect(findings.unbound.map((item) => item.split(' ')[0])).toEqual([
            'missingRef', 'setMissing', 'useBackHandler', 'useBackHandler',
        ]);
        expect(findings.duplicateImports).toHaveLength(1);
        expect(findings.duplicateHooks).toHaveLength(1);
        expect(scan('const duplicate = 1; const duplicate = 2;').syntax).toHaveLength(1);
        expect(scan('function duplicate() {} function duplicate() {}').syntax).toHaveLength(1);
    });

    it('discovers the requested source areas', () => {
        expect(entries.length).toBeGreaterThan(400);
    });

    for (const [key, code] of entries) {
        it(display(key), () => {
            expect(scan(code)).toEqual({
                syntax: [],
                unbound: [],
                duplicateImports: [],
                duplicateHooks: [],
            });
        });
    }
});
