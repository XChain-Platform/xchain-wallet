// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { workspaceAlias } from '../../vitest/workspaceAlias.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUTES_DIR = resolve(ROOT, 'packages/core/src/shared/routes');
const UI_DIR = resolve(ROOT, 'packages/core/src/ui');
const UI_INDEX = resolve(UI_DIR, 'index.js');
const UNIT_CONFIG = resolve(ROOT, 'test/vitest/unit.config.js');
const SHELL_APPS = [
    'packages/web/src/App.jsx',
    'packages/extension/src/popup/App.jsx',
    'packages/desktop/renderer/App.jsx',
].map((file) => resolve(ROOT, file));
// Shell-owned source the mount walk follows: a shell may mount a screen from a
// surface module (web's surfaces/dex.jsx) rather than from App.jsx itself.
const SHELL_ROOTS = [
    'packages/web/src',
    'packages/extension/src',
    'packages/desktop/renderer',
].map((dir) => resolve(ROOT, dir) + sep);
const TEMPLATES = new Set(['Screen', 'PageHeader', 'FormPage', 'ListPage']);
const ALIASES = workspaceAlias(ROOT);

// The file view the checks read through. The real disk by default; the fixture
// cases lay virtual sources over it so each gap has a case of its own.
const disk = {
    read: (file) => readFileSync(file, 'utf8'),
    exists: (file) => existsSync(file) && statSync(file).isFile(),
};

function overlay(sources) {
    return {
        read: (file) => (sources.has(file) ? sources.get(file) : disk.read(file)),
        exists: (file) => sources.has(file) || disk.exists(file),
    };
}

function walk(node, visit) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'loc') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
        else if (value && typeof value === 'object') walk(value, visit);
    }
}

function checker(view) {
    const asts = new Map();

    function ast(file) {
        if (!asts.has(file)) asts.set(file, parse(view.read(file), { sourceType: 'module', plugins: ['jsx'] }));
        return asts.get(file);
    }

    function asFile(path) {
        return [path, `${path}.jsx`, `${path}.js`, `${path}/index.js`, `${path}/index.jsx`].find((c) => view.exists(c)) ?? null;
    }

    // A relative path or a workspace specifier, resolved the way the unit config aliases it.
    function resolveSpecifier(from, specifier) {
        if (specifier.startsWith('.')) return asFile(resolve(dirname(from), specifier));
        const alias = ALIASES.find((entry) => entry.find.test(specifier));
        return alias ? asFile(specifier.replace(alias.find, alias.replacement)) : null;
    }

    // Every module a file loads: static imports, re-exports and literal import() calls.
    function dependencies(file) {
        const specifiers = [];
        walk(ast(file).program, (node) => {
            if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration)$/.test(node.type) && node.source) {
                specifiers.push(node.source.value);
            } else if (node.type === 'ImportExpression' && node.source.type === 'StringLiteral') {
                specifiers.push(node.source.value);
            } else if (node.type === 'CallExpression' && node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') {
                specifiers.push(node.arguments[0].value);
            }
        });
        return specifiers.map((specifier) => resolveSpecifier(file, specifier)).filter(Boolean);
    }

    // A module made only of imports and re-exports passes its routes straight through.
    function isBarrel(file) {
        return ast(file).program.body.every((node) => node.type === 'ImportDeclaration'
            || node.type === 'ExportAllDeclaration'
            || (node.type === 'ExportNamedDeclaration' && !node.declaration));
    }

    const inRoutes = (file) => dirname(file) === ROUTES_DIR;

    // Every routes/ module the shells mount, through any import path the shells
    // own or any barrel between them and the screen.
    function routedFrom(shells) {
        const found = new Set();
        const seen = new Set();
        const queue = [...shells];
        while (queue.length) {
            const file = queue.shift();
            if (seen.has(file)) continue;
            seen.add(file);
            for (const target of dependencies(file)) {
                if (!/\.jsx?$/.test(target)) continue;
                if (inRoutes(target)) found.add(target);
                else if (SHELL_ROOTS.some((root) => target.startsWith(root)) || isBarrel(target)) queue.push(target);
            }
        }
        return [...found].sort();
    }

    // Local names a file binds to a page template, and namespace names bound to the ui barrel.
    function templateBindings(file) {
        const names = new Set();
        const namespaces = new Set();
        for (const node of ast(file).program.body) {
            if (node.type !== 'ImportDeclaration') continue;
            const target = resolveSpecifier(file, node.source.value);
            if (!target) continue;
            const fromBarrel = target === UI_INDEX;
            const fileTemplate = dirname(target) === UI_DIR ? basename(target).replace(/\.jsx$/, '') : null;
            for (const spec of node.specifiers) {
                if (spec.type === 'ImportNamespaceSpecifier' && fromBarrel) namespaces.add(spec.local.name);
                if (spec.type === 'ImportSpecifier' && TEMPLATES.has(spec.imported.name) && (fromBarrel || spec.imported.name === fileTemplate)) {
                    names.add(spec.local.name);
                }
                if (spec.type === 'ImportDefaultSpecifier' && TEMPLATES.has(fileTemplate)) names.add(spec.local.name);
            }
        }
        return { names, namespaces };
    }

    function renderedElements(file) {
        const names = new Set();
        const members = [];
        walk(ast(file).program, (node) => {
            if (node.type !== 'JSXOpeningElement') return;
            if (node.name.type === 'JSXIdentifier') names.add(node.name.name);
            if (node.name.type === 'JSXMemberExpression' && node.name.object.type === 'JSXIdentifier') {
                members.push([node.name.object.name, node.name.property.name]);
            }
        });
        return { names, members };
    }

    function rendersTemplate(file) {
        const bound = templateBindings(file);
        const rendered = renderedElements(file);
        return [...bound.names].some((name) => rendered.names.has(name))
            || rendered.members.some(([object, property]) => bound.namespaces.has(object) && TEMPLATES.has(property));
    }

    // One wrapper level: the screen renders a relative .jsx component that renders a template.
    function rendersWrappedTemplate(file) {
        const rendered = renderedElements(file).names;
        return ast(file).program.body.some((node) => {
            if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) return false;
            const wrapper = resolveSpecifier(file, node.source.value);
            if (!wrapper || !wrapper.endsWith('.jsx')) return false;
            return node.specifiers.some((spec) => rendered.has(spec.local.name)) && rendersTemplate(wrapper);
        });
    }

    function usesTemplate(file) {
        return rendersTemplate(file) || rendersWrappedTemplate(file);
    }

    // Route modules another route module loads: rows, cards, pickers and shared helpers.
    function routeHelpers(routeFiles) {
        const helpers = new Set();
        for (const file of routeFiles) {
            for (const target of dependencies(file)) {
                if (inRoutes(target) && target !== file) helpers.add(target);
            }
        }
        return helpers;
    }

    // Route modules no shell mounts and no route loads: a screen the gate cannot see.
    function unaccounted(routed, routeFiles) {
        const helpers = routeHelpers(routeFiles);
        const mounted = new Set(routed);
        return routeFiles.filter((file) => !mounted.has(file) && !helpers.has(file)).sort();
    }

    return { routedFrom, usesTemplate, unaccounted };
}

function routeModules() {
    return readdirSync(ROUTES_DIR).filter((name) => /\.jsx?$/.test(name)).map((name) => resolve(ROUTES_DIR, name));
}

function offendersOf(check, files) {
    return files.filter((file) => !check.usesTemplate(file)).map((file) => relative(ROOT, file));
}

// Virtual sources, one per gap: a screen mounted from a shell surface module, one
// behind a barrel, one that imports a template and never renders it, one whose
// wrapper is imported but never rendered, and one route no shell mounts.
const fx = (name) => resolve(ROUTES_DIR, `${name}.jsx`);
const FIXTURE_SHELL = resolve(ROOT, 'packages/web/src/fixture-shell/App.jsx');
const FIXTURE = new Map([
    [FIXTURE_SHELL, `
        import { FxDirect } from '@xchain-wallet/core/shared/routes/FxDirect.jsx';
        import { FxImportOnly } from '@xchain-wallet/core/shared/routes/FxImportOnly.jsx';
        import { FxUnrenderedWrapper } from '@xchain-wallet/core/shared/routes/FxUnrenderedWrapper.jsx';
        import { FxWrapped } from '@xchain-wallet/core/shared/routes/FxWrapped.jsx';
        import { renderSurface } from './surface.jsx';
        import { FxBarrelled } from './barrel.js';
        export const App = () => <FxDirect />;
    `],
    [resolve(ROOT, 'packages/web/src/fixture-shell/surface.jsx'), `
        import { lazy } from 'react';
        const FxSurface = lazy(() => import('@xchain-wallet/core/shared/routes/FxSurface.jsx'));
        export const renderSurface = () => <FxSurface />;
    `],
    [resolve(ROOT, 'packages/web/src/fixture-shell/barrel.js'), `
        export { FxBarrelled } from '@xchain-wallet/core/shared/routes/FxBarrelled.jsx';
    `],
    [fx('FxDirect'), `
        import { Screen } from '@xchain-wallet/core/ui';
        export const FxDirect = () => <Screen title="Direct" />;
    `],
    [fx('FxSurface'), `
        import { FormPage as Page } from '@xchain-wallet/core/ui/FormPage.jsx';
        export default function FxSurface() { return <Page />; }
    `],
    [fx('FxBarrelled'), `
        import * as ui from '@xchain-wallet/core/ui';
        export const FxBarrelled = () => <ui.ListPage />;
    `],
    [fx('FxImportOnly'), `
        import { Screen } from '@xchain-wallet/core/ui';
        export const FxImportOnly = () => <div>{String(Screen)}</div>;
    `],
    [fx('FxFrame'), `
        import { PageHeader } from '@xchain-wallet/core/ui';
        export const Frame = ({ children }) => <><PageHeader title="Frame" />{children}</>;
    `],
    [fx('FxUnrenderedWrapper'), `
        import { Frame } from './FxFrame.jsx';
        export const FxUnrenderedWrapper = () => <div data-frame={Boolean(Frame)} />;
    `],
    [fx('FxWrapped'), `
        import { Frame } from './FxFrame.jsx';
        export const FxWrapped = () => <Frame><p /></Frame>;
    `],
    [fx('FxOrphan'), `
        import { Screen } from '@xchain-wallet/core/ui';
        export const FxOrphan = () => <Screen />;
    `],
]);
const FIXTURE_ROUTES = [...FIXTURE.keys()].filter((file) => dirname(file) === ROUTES_DIR);

describe('page templates', () => {
    const check = checker(disk);
    const files = check.routedFrom(SHELL_APPS);

    it('runs in the unit suite', () => {
        expect(disk.read(UNIT_CONFIG)).toContain("'test/unit/**/*.test.{js,jsx}'");
    });

    it('finds the routed screens', () => {
        expect(files.length).toBeGreaterThan(50);
    });

    it('finds the screens a shell mounts through a surface module', () => {
        const web = check.routedFrom([SHELL_APPS[0]]).map((file) => basename(file));
        expect(web).toEqual(expect.arrayContaining(['MarketsList.jsx', 'MarketView.jsx', 'SwapForm.jsx']));
    });

    it('accounts for every route module as a mounted screen or a helper a route loads', () => {
        const leftovers = check.unaccounted(files, routeModules()).map((file) => relative(ROOT, file));
        expect(leftovers, `${leftovers.join('\n')}\nis neither mounted by a shell nor loaded by a route`).toEqual([]);
    });

    it('builds every routed screen from Screen, PageHeader, FormPage or ListPage', () => {
        const offenders = offendersOf(check, files);
        expect(offenders, `${offenders.join('\n')}\nrenders no page template element`).toEqual([]);
    });

    describe('gate fixtures', () => {
        const fixtureCheck = checker(overlay(FIXTURE));
        const routed = fixtureCheck.routedFrom([FIXTURE_SHELL]);

        it('resolves screens mounted directly, through a surface module and through a barrel', () => {
            expect(routed).toEqual(expect.arrayContaining([fx('FxDirect'), fx('FxSurface'), fx('FxBarrelled')]));
        });

        it('flags a screen that imports a template without rendering it, and an unrendered wrapper', () => {
            expect(offendersOf(fixtureCheck, routed).sort()).toEqual([
                relative(ROOT, fx('FxImportOnly')),
                relative(ROOT, fx('FxUnrenderedWrapper')),
            ]);
        });

        it('names a route module that no shell mounts and no route loads', () => {
            expect(fixtureCheck.unaccounted(routed, FIXTURE_ROUTES)).toEqual([fx('FxOrphan')]);
        });
    });
});
