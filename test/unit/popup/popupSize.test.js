// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

// packages/extension/popup-size.js: the classic script popup.html runs from
// <head> before the module bundle. Each case runs it in a fresh JSDOM window
// built like popup.html (boot screen inside #xchain-popup-root), so listeners
// never leak between cases. The real toolbar popup is measured by
// test/e2e/tests/layout/toolbar-popup-size.extension.spec.js.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it, vi } from 'vitest';
import firstPaint from '../../../packages/core/src/i18n/locales/en/firstPaint.js';
import extensionCopy from '../../../packages/core/src/i18n/locales/en/extension.js';
import importWallet from '../../../packages/core/src/i18n/locales/en/importWallet.js';

const SOURCE = readFileSync(resolve('packages/extension/popup-size.js'), 'utf8');
const POPUP_HTML = readFileSync(resolve('packages/extension/popup.html'), 'utf8');
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const traverse = _traverse.default || _traverse;

// The same post-ES5 list test/unit/web/bootCheck.test.js holds boot-check.js to.
const POST_ES5 = new Set([
    'ArrowFunctionExpression', 'TemplateLiteral', 'TaggedTemplateExpression',
    'ClassDeclaration', 'ClassExpression', 'SpreadElement', 'RestElement',
    'ObjectPattern', 'ArrayPattern', 'AssignmentPattern', 'ForOfStatement',
    'YieldExpression', 'AwaitExpression', 'OptionalMemberExpression',
    'OptionalCallExpression', 'BigIntLiteral', 'ImportDeclaration',
    'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ObjectMethod',
]);

function runPopupSize({ path = '/popup.html', views = 'self', width = 360, getViewsThrows = false, tabs = true } = {}) {
    // The script runs from <head>; the boot screen is in the body by the time
    // a module script can fail, which is what this document models.
    const dom = new JSDOM(POPUP_HTML.replace(/<script type="module"[^>]*><\/script>/, ''), {
        url: `${ORIGIN}${path}`,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const create = vi.fn(() => Promise.resolve({ id: 7 }));
    window.chrome = {
        extension: {
            getViews: vi.fn(() => {
                if (getViewsThrows) throw new Error('no view enumeration');
                return views === 'self' ? [window] : [];
            }),
        },
        runtime: { getURL: (file) => `${ORIGIN}/${file}` },
        tabs: tabs ? { create } : undefined,
    };
    window.close = vi.fn();
    window.eval(SOURCE);
    const html = window.document.documentElement;
    const failure = () => window.document.querySelector('[data-xc-boot-failure]');
    const throwError = (error) => window.dispatchEvent(new window.ErrorEvent('error', {
        error, message: `Uncaught ${error}`, filename: `${ORIGIN}/chunks/core-abc.js`, lineno: 1, colno: 7,
    }));
    const reject = (reason) => {
        const event = new window.Event('unhandledrejection');
        event.reason = reason;
        window.dispatchEvent(event);
    };
    return { window, html, failure, throwError, reject, create };
}

describe('popup-size.js: sizing', () => {
    it('marks the toolbar popup before any module runs', () => {
        const { html } = runPopupSize();
        expect(html.classList.contains('xchain-toolbar-popup')).toBe(true);
    });

    it('leaves popup.html opened in a tab at the full document width', () => {
        const { html } = runPopupSize({ views: 'none', width: 1280 });
        expect(html.classList.contains('xchain-toolbar-popup')).toBe(false);
    });

    it('trusts view enumeration over width, so a narrow tab is not the popup', () => {
        const { html } = runPopupSize({ views: 'none', width: 360 });
        expect(html.classList.contains('xchain-toolbar-popup')).toBe(false);
    });

    it('never marks the side panel', () => {
        const { html } = runPopupSize({ path: '/sidepanel.html' });
        expect(html.classList.contains('xchain-toolbar-popup')).toBe(false);
    });

    it.each([
        [360, true],
        [1280, false],
    ])('falls back to width %i when views cannot be enumerated', (width, popup) => {
        const { html } = runPopupSize({ getViewsThrows: true, width });
        expect(html.classList.contains('xchain-toolbar-popup')).toBe(popup);
    });
});

describe('popup-size.js: load failure', () => {
    it('replaces the boot screen with the danger notice, details and both actions', () => {
        const { window, html, failure, throwError } = runPopupSize();
        throwError(new Error('simulated import-time failure'));

        const page = failure();
        expect(page).not.toBeNull();
        expect(window.document.querySelector('.xc-boot')).toBeNull();
        expect(page.parentElement.id).toBe('xchain-popup-root');
        const notice = page.querySelector('[role="alert"]');
        expect(notice.getAttribute('data-tone')).toBe('danger');
        expect(notice.textContent).toContain("XChain Wallet couldn't start.");
        expect(page.querySelector('details summary').textContent).toBe('Technical details');
        expect(page.querySelector('details').open).toBe(false);
        expect(page.querySelector('details code').textContent).toContain('Error: simulated import-time failure');
        expect([...page.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Reload', 'Open in tab']);
        expect(html.style.width).toBe('360px');
        expect(html.style.height).toBe('600px');
    });

    it('opens the full-page wallet in a tab and closes the popup', async () => {
        const { window, failure, throwError, create } = runPopupSize();
        throwError(new Error('boom'));
        [...failure().querySelectorAll('button')].find((b) => b.textContent === 'Open in tab').click();
        expect(create).toHaveBeenCalledWith({ url: `${ORIGIN}/popup.html` });
        await Promise.resolve();
        await Promise.resolve();
        expect(window.close).toHaveBeenCalledOnce();
    });

    it('offers only Reload in a tab, where another tab would not help', () => {
        const { failure, throwError, html } = runPopupSize({ views: 'none', width: 1280 });
        throwError(new Error('boom'));
        expect([...failure().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Reload']);
        expect(html.style.width).toBe('');
    });

    it('reports an unhandled rejection with its reason', () => {
        const { failure, reject } = runPopupSize();
        reject({ name: 'TypeError', message: 'chunk refused' });
        expect(failure().querySelector('details code').textContent).toBe('TypeError: chunk refused');
    });

    it('reports a script that failed to load by its src', () => {
        const { window, failure } = runPopupSize();
        const script = window.document.createElement('script');
        script.setAttribute('src', '/chunks/core-missing.js');
        window.document.head.appendChild(script);
        script.dispatchEvent(new window.Event('error'));
        expect(failure().querySelector('details code').textContent)
            .toBe(`Failed to load script: ${ORIGIN}/chunks/core-missing.js`);
    });

    it('ignores an image or stylesheet that failed to load', () => {
        const { window, failure } = runPopupSize();
        const image = window.document.createElement('img');
        window.document.body.appendChild(image);
        image.dispatchEvent(new window.Event('error'));
        expect(failure()).toBeNull();
        expect(window.document.querySelector('.xc-boot')).not.toBeNull();
    });

    it('shows one notice for several failures, holding the first', () => {
        const { window, throwError, reject } = runPopupSize();
        throwError(new Error('first'));
        reject(new Error('second'));
        throwError(new Error('third'));
        const pages = window.document.querySelectorAll('[data-xc-boot-failure]');
        expect(pages).toHaveLength(1);
        expect(pages[0].querySelector('details code').textContent).toContain('first');
    });

    it('stops interfering once the app has mounted', () => {
        const { window, failure, throwError, reject } = runPopupSize();
        const container = window.document.getElementById('xchain-popup-root');
        container.innerHTML = '<main id="app">wallet</main>';
        throwError(new Error('a later bug the app reports itself'));
        reject(new Error('a later rejection'));
        expect(failure()).toBeNull();
        expect(container.innerHTML).toBe('<main id="app">wallet</main>');
    });
});

describe('popup-size.js: source rules', () => {
    it('stays an ES5 classic script, so it parses on any engine the bundle might fail on', () => {
        const found = [];
        traverse(parse(SOURCE, { sourceType: 'script' }), {
            enter({ node }) {
                if (POST_ES5.has(node.type)) found.push(node.type);
                if (node.type === 'VariableDeclaration' && node.kind !== 'var') found.push(`${node.kind} declaration`);
                if (node.type === 'ObjectProperty' && node.shorthand) found.push('shorthand property');
                if (node.type === 'LogicalExpression' && node.operator === '??') found.push('nullish coalescing');
            },
        });
        expect(found).toEqual([]);
    });

    it('matches the English of the dictionary keys it stands in for', () => {
        expect(SOURCE).toContain(`details: '${firstPaint['pending.detail.technicalDetails']}'`);
        expect(SOURCE).toContain(`reload: '${extensionCopy['extension.connection.reload']}'`);
        expect(SOURCE).toContain(`openInTab: '${importWallet['importWallet.openInTab']}'`);
    });
});

describe('popup-size.js: build wiring', () => {
    it('emits popup-size.js and injects it into popup.html only, after the theme script', async () => {
        const { default: config, isPopupHtml } = await import('../../../packages/extension/vite.config.js');
        const plugin = config.plugins.find(({ name }) => name === 'xchain-startup-theme');

        const emitted = [];
        await plugin.buildStart.call({ emitFile: (asset) => emitted.push(asset) });
        expect(emitted.find(({ fileName }) => fileName === 'popup-size.js')).toEqual({
            type: 'asset', fileName: 'popup-size.js', source: SOURCE,
        });

        const scripts = (file) => plugin.transformIndexHtml.handler('', {
            path: `/${file}`,
            filename: resolve('packages/extension', file),
        }).filter(({ tag }) => tag === 'script').map(({ attrs }) => attrs.src);
        expect(scripts('popup.html')).toEqual(['/theme-init.js', '/popup-size.js']);
        expect(scripts('sidepanel.html')).toEqual(['/theme-init.js']);
        expect(scripts('approval.html')).toEqual(['/theme-init.js']);
        expect(isPopupHtml(undefined)).toBe(false);
    });
});
