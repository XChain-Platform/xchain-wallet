// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

// The token picker control is a button, so it takes the shared Button base
// for its press, focus and hidden states from markup, then keeps the Input
// chrome: the field height scale, the control radius, start-aligned
// single-line text and the regular field weight. The behavior tests never
// read the stylesheet, so this reads it directly.
//
// A CSS-file composes from Button.module.css inlines a second copy of that
// sheet into the composing module's CSS, so the lazy TokenField chunk would
// load a later .btn that re-applies over every other button's overrides. The
// build test bundles the field's stylesheets as the web shell does, with the
// main chunk owning Button.module.css, and counts the copies in the field's
// chunk.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import webConfig from '../../../packages/web/vite.config.js';

const css = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
const coreSrc = resolve('packages/core/src');
const fieldJsxPath = resolve(coreSrc, 'shared/components/TokenField.jsx');
const fieldCssPath = resolve(coreSrc, 'shared/components/TokenField.module.css');
const buttonCssPath = resolve(coreSrc, 'ui/Button.module.css');
// One match per copy of Button.module.css: its hidden rule appears once in it.
const BUTTON_COPY = /\._btn_[A-Za-z0-9-]+_\d+\[hidden\]/g;

// Every stylesheet TokenField.jsx imports, as absolute paths in import order.
function fieldStylesheets() {
    const jsx = readFileSync(fieldJsxPath, 'utf8');
    return [...jsx.matchAll(/^import\s+(?:\w+\s+from\s+)?'([^']+\.css)';/gm)]
        .map((match) => resolve(fieldJsxPath, '..', match[1]));
}

// The entry stands for the app's main chunk, which owns Button.module.css; the
// field's stylesheets load behind a dynamic import, as the route-lazy forms
// load TokenField.
async function buildFieldChunk() {
    const entryId = '\0token-field-entry';
    const lazyId = '\0token-field-lazy';
    const fixture = {
        name: 'token-field-fixture',
        resolveId(id) {
            if (id === 'token-field-entry') return entryId;
            if (id === 'token-field-lazy') return lazyId;
            return null;
        },
        load(id) {
            if (id === entryId) {
                // An app build drops entry exports, so the entry keeps its
                // class map and the lazy import reachable through a global.
                return [
                    `import button from ${JSON.stringify(buttonCssPath)};`,
                    "globalThis.tokenFieldFixture = [button, () => import('token-field-lazy')];",
                ].join('\n');
            }
            if (id === lazyId) {
                // The class maps stay exported so the chunk is not a pure-CSS
                // chunk, which Vite folds into its importer.
                const sheets = fieldStylesheets();
                return [
                    ...sheets.map((path, index) => `import sheet${index} from ${JSON.stringify(path)};`),
                    `export default [${sheets.map((_path, index) => `sheet${index}`).join(', ')}];`,
                ].join('\n');
            }
            return null;
        },
    };
    const output = await build({
        configFile: false,
        root: coreSrc,
        logLevel: 'silent',
        css: webConfig.css,
        resolve: webConfig.resolve,
        plugins: [fixture],
        build: {
            write: false,
            minify: false,
            sourcemap: false,
            cssCodeSplit: true,
            rollupOptions: { input: 'token-field-entry' },
        },
    });
    const items = (Array.isArray(output) ? output[0] : output).output;
    const cssOf = (chunk) => [...(chunk.viteMetadata?.importedCss ?? [])]
        .map((name) => items.find((item) => item.fileName === name).source)
        .join('\n');
    const field = items.find((item) => item.type === 'chunk' && item.moduleIds.includes(fieldCssPath));
    const entry = items.find((item) => item.type === 'chunk' && item.isEntry);
    return { field: field && cssOf(field), entry: entry && cssOf(entry) };
}
const rule = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('}', start));
};

const source = css('shared/components/TokenField.module.css');

describe('token field control', () => {
    it('takes the shared Button base class from markup, never from composes', () => {
        expect(source).not.toMatch(/composes:/);
        const jsx = readFileSync('packages/core/src/shared/components/TokenField.jsx', 'utf8');
        expect(jsx).toContain('buttonStyles.btn');
    });

    it('carries no copy of Button.module.css in the field chunk the build emits', async () => {
        const { field, entry } = await buildFieldChunk();
        expect(field, 'the build emits CSS for the field chunk').toContain('--token-field-control-height');
        expect(entry.match(BUTTON_COPY) ?? [], 'the main chunk owns one Button.module.css').toHaveLength(1);
        expect(field.match(BUTTON_COPY) ?? [], 'Button.module.css copies in the field chunk').toHaveLength(0);
    }, 60000);

    it('keeps the field height scale and the control radius', () => {
        const control = rule(source, '.control');
        expect(control).toMatch(/(^|[\s;])height:\s*var\(--token-field-control-height\)/);
        expect(control).toContain('border-radius: var(--xc-control-radius)');
    });

    it('keeps start-aligned single-line text at the field weight over the Button base', () => {
        const control = rule(source, '.control');
        expect(control).toContain('justify-content: flex-start');
        expect(control).toContain('text-align: start');
        expect(control).toContain('white-space: nowrap');
        expect(control).toContain('font-weight: 400');
    });

    it('raises the lg control to the large field height', () => {
        expect(rule(source, '.lg')).toContain('--token-field-control-height: var(--xc-control-h-lg)');
    });
});
