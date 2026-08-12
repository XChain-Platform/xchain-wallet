// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The PRE-BUNDLE capability floor.
//
// Found by running the app for the first time on an API 26 emulator
// (2026-08-01): the Android 8 stock WebView is Chromium 58, which ignores
// `<script type="module">` outright. The bundle never loaded, so the floor
// inside the bundle never ran, and the wallet was a white screen with nothing
// in the console. `public/boot-check.js` is the tier that runs first.
//
// Two things are pinned here, and they fail in opposite directions:
//   - the BEHAVIOUR (does it refuse the right engines and stay out of the way
//     on the right ones), and
//   - the SYNTAX (is the file itself still parseable by an engine from 2015).
// The second matters more than it looks: a modern-syntax tidy-up of this file
// would break it silently on precisely the engines it exists to catch, and no
// behavioural test running on Node would notice.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { floorFailureMessage } from '../../../packages/web/src/platform/webviewFloor.js';

const traverse = _traverse.default || _traverse;

// Repo-root-relative, like the other file-reading suites here: vitest runs
// with jsdom, where `import.meta.url` is not a file: URL.
const BOOT_CHECK = join(process.cwd(), 'packages/web/public/boot-check.js');
const INDEX_HTML = join(process.cwd(), 'packages/web/index.html');
const VITE_CONFIG = join(process.cwd(), 'packages/web/vite.config.js');

const source = readFileSync(BOOT_CHECK, 'utf8');

// --- a DOM small enough to be obviously correct -----------------------------
//
// Hand-rolled rather than jsdom because every test here is about an engine
// MISSING something, and jsdom insists on providing `crypto`, `indexedDB` and
// friends. The point is to withhold them.

function fakeElement(tagName) {
    return {
        tagName,
        children: [],
        attributes: {},
        style: { cssText: '' },
        textContent: '',
        setAttribute(k, v) { this.attributes[k] = v; },
        appendChild(child) { this.children.push(child); return child; },
    };
}

/**
 * Run boot-check.js against a synthetic engine.
 *
 * @param {object} [engine] globals to expose; anything omitted is ABSENT,
 *                          which is the whole point of the fixture
 * @param {object} [opts]
 * @param {string} [opts.readyState]
 * @returns {{ root: object, window: object, fire: (name: string) => void }}
 */
function runBootCheck(engine = {}, opts = {}) {
    const root = fakeElement('div');
    const body = fakeElement('body');
    const listeners = {};

    const document = {
        readyState: opts.readyState || 'complete',
        body,
        createElement: (tag) => fakeElement(tag),
        getElementById: (id) => (id === 'xchain-web-root' ? root : null),
        addEventListener: (name, fn) => {
            (listeners[name] = listeners[name] || []).push(fn);
        },
    };

    // `noModule` support is expressed the way the browser expresses it: as a
    // property present on a freshly created <script>.
    if (engine.modules) {
        const createElement = document.createElement;
        document.createElement = (tag) => {
            const el = createElement(tag);
            if (tag === 'script') el.noModule = false;
            return el;
        };
    }

    const window = { document };
    if (engine.crypto) window.crypto = engine.crypto;
    if (engine.indexedDB) window.indexedDB = engine.indexedDB;
    if (engine.TextEncoder) window.TextEncoder = engine.TextEncoder;
    if (engine.TextDecoder) window.TextDecoder = engine.TextDecoder;
    if (engine.BigInt) window.BigInt = engine.BigInt;

    // No host `Object`/`Array` in the sandbox: `vm.createContext` gives the
    // context its OWN intrinsics, and the pre-ES2022 fixture below deletes
    // methods off them. Handing in the host's would delete `Object.hasOwn`
    // from this process, which is a fixture that quietly breaks every later
    // test in the file (it did, before this comment existed).
    const context = vm.createContext({ window, document });

    // ES2022 library markers stand in for an ES2022 PARSER (see the file). A
    // context that should look pre-ES2022 has to lose them from the intrinsics
    // the script actually reaches.
    if (!engine.es2022) {
        vm.runInContext(
            'Object.hasOwn = undefined; Array.prototype.at = undefined;',
            context,
        );
    }

    vm.runInContext(source, context, { filename: 'boot-check.js' });

    return {
        root,
        window,
        fire: (name) => (listeners[name] || []).forEach((fn) => fn()),
    };
}

/** An engine with everything the wallet needs. */
function capableEngine() {
    return {
        modules: true,
        es2022: true,
        crypto: { subtle: { importKey() {}, encrypt() {} }, getRandomValues() {} },
        indexedDB: { open() {} },
        TextEncoder: function TextEncoder() {},
        TextDecoder: function TextDecoder() {},
        BigInt: function BigInt() {},
    };
}

const panelText = (root) => root.children
    .flatMap((panel) => panel.children.map((c) => c.textContent))
    .join(' ');

describe('boot-check.js: the tier that runs before the bundle', () => {
    it('stays completely out of the way on a capable engine', () => {
        const { root, window } = runBootCheck(capableEngine());
        expect(window.__xchainBootFloor).toBeUndefined();
        expect(root.children).toHaveLength(0);
    });

    it('refuses an engine that ignores module scripts (Chromium 58, API 26)', () => {
        // The measured case: no module support, and no BigInt either.
        const engine = capableEngine();
        engine.modules = false;
        engine.es2022 = false;
        delete engine.BigInt;

        const { root, window } = runBootCheck(engine);

        expect(window.__xchainBootFloor.blocked).toBe(true);
        expect(window.__xchainBootFloor.missing).toContain('JavaScript modules');
        expect(root.children).toHaveLength(1);
        expect(panelText(root)).toContain('cannot run XChain Wallet safely');
    });

    it('refuses an engine with modules but a pre-ES2022 parser', () => {
        // This is the case a `noModule` check alone misses: the module IS
        // fetched, then dies on a SyntaxError before its first statement.
        const engine = capableEngine();
        engine.es2022 = false;

        const { window } = runBootCheck(engine);

        expect(window.__xchainBootFloor.blocked).toBe(true);
        expect(window.__xchainBootFloor.missing).toContain('modern JavaScript (ES2022)');
    });

    it('names the individual primitive that is missing', () => {
        const engine = capableEngine();
        delete engine.BigInt;

        const { window, root } = runBootCheck(engine);

        expect(window.__xchainBootFloor.missing).toEqual(['BigInt']);
        expect(panelText(root)).toContain('BigInt');
    });

    it.each([
        ['crypto.subtle', (e) => { e.crypto = { getRandomValues() {} }; }],
        ['crypto.getRandomValues', (e) => { e.crypto = { subtle: { importKey() {}, encrypt() {} } }; }],
        ['indexedDB', (e) => { delete e.indexedDB; }],
        ['TextEncoder/TextDecoder', (e) => { delete e.TextDecoder; }],
    ])('refuses an engine missing %s', (name, break_) => {
        const engine = capableEngine();
        break_(engine);
        const { window } = runBootCheck(engine);
        expect(window.__xchainBootFloor.missing).toContain(name);
    });

    it('rejects a subtle object whose methods are absent, not merely a missing one', () => {
        const engine = capableEngine();
        engine.crypto = { subtle: {}, getRandomValues() {} };
        const { window } = runBootCheck(engine);
        expect(window.__xchainBootFloor.missing).toContain('crypto.subtle');
    });

    it('waits for DOMContentLoaded when it runs from <head>', () => {
        // It is loaded in <head>, so #xchain-web-root does not exist yet.
        // Rendering eagerly there would draw into nothing.
        const engine = capableEngine();
        engine.modules = false;

        const { root, fire } = runBootCheck(engine, { readyState: 'loading' });
        expect(root.children).toHaveLength(0);

        fire('DOMContentLoaded');
        expect(root.children).toHaveLength(1);
    });

    it('clears whatever was in the root before drawing the refusal', () => {
        const engine = capableEngine();
        engine.modules = false;
        const { root } = runBootCheck(engine);
        expect(root.textContent).toBe('');
        expect(root.children[0].attributes.role).toBe('alert');
    });

    it('says the same things the in-bundle floor says', () => {
        // The two floors cannot share code across the module boundary, so the
        // agreement is asserted instead of enforced. Substance, not wording:
        // what is missing, that the engine can be updated, and that the
        // recovery phrase is unaffected.
        const engine = capableEngine();
        delete engine.BigInt;
        const { root } = runBootCheck(engine);
        const ours = panelText(root);
        const theirs = floorFailureMessage({ missing: ['BigInt'], usable: false });

        for (const phrase of [
            'The browser engine here is missing: BigInt.',
            'Updating Android System WebView',
            'Your recovery phrase is unaffected',
        ]) {
            expect(ours).toContain(phrase);
            expect(theirs).toContain(phrase);
        }
    });
});

describe('boot-check.js: still parseable by a 2015 engine', () => {
    // A floor written in syntax its target cannot parse is not a floor. Node
    // runs the behavioural tests above happily on any syntax, so this is the
    // only thing standing between a tidy-up and a silent regression.
    const POST_ES5 = new Set([
        'ArrowFunctionExpression', 'TemplateLiteral', 'TaggedTemplateExpression',
        'ClassDeclaration', 'ClassExpression', 'SpreadElement', 'RestElement',
        'ObjectPattern', 'ArrayPattern', 'AssignmentPattern', 'ForOfStatement',
        'YieldExpression', 'AwaitExpression', 'OptionalMemberExpression',
        'OptionalCallExpression', 'BigIntLiteral', 'ImportDeclaration',
        'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ObjectMethod',
    ]);

    it('contains no post-ES5 syntax', () => {
        const ast = parse(source, { sourceType: 'script' });
        const found = [];

        traverse(ast, {
            enter(path) {
                const { node } = path;
                if (POST_ES5.has(node.type)) found.push(node.type);
                if (node.type === 'VariableDeclaration' && node.kind !== 'var') {
                    found.push(`${node.kind} declaration`);
                }
                if (node.type === 'ObjectProperty' && node.shorthand) {
                    found.push('shorthand property');
                }
                if (node.type === 'LogicalExpression' && node.operator === '??') {
                    found.push('nullish coalescing');
                }
            },
        });

        expect(found).toEqual([]);
    });

    it('is a classic script: no module syntax at all', () => {
        // sourceType 'script' would have thrown above on import/export, but
        // the intent is worth stating rather than inferring from a passing
        // parse of a different assertion.
        expect(() => parse(source, { sourceType: 'script' })).not.toThrow();
    });
});

describe('boot-check.js: wired into the page ahead of the bundle', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');

    it('is referenced from index.html', () => {
        expect(html).toContain('src="/boot-check.js"');
    });

    it('loads it as a classic script, never a module', () => {
        // `type="module"` here would defer it behind the very bundle it is
        // meant to precede, and make it unparseable on the target engines.
        const tag = /<script[^>]*boot-check\.js[^>]*>/.exec(html)?.[0] ?? '';
        expect(tag).not.toMatch(/type\s*=/);
        expect(tag).not.toMatch(/\b(defer|async)\b/);
    });

    it('appears before the app bundle entry', () => {
        expect(html.indexOf('/boot-check.js')).toBeLessThan(html.indexOf('/src/main.jsx'));
    });

    it('sits in <head>, where it runs before the body is parsed', () => {
        const head = html.slice(0, html.indexOf('</head>'));
        expect(head).toContain('/boot-check.js');
    });
});

describe('the ES2022 markers are tied to the build target', () => {
    it('vite still targets es2022, which is what the markers stand in for', () => {
        // If this fails, `build.target` moved and boot-check.js's two library
        // probes are now testing for the wrong era. Change both together.
        expect(readFileSync(VITE_CONFIG, 'utf8')).toContain("target: 'es2022'");
    });
});
