// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One template per page kind: every screen a shell routes to lays out through
// the kit (packages/core/src/ui). A form page renders through <FormPage> (with
// <FormSection> groups), a list or detail page through <ListPage>, an empty
// list through <EmptyState> and a group title through <SectionHeader>. A page
// file that draws its own <form>, its own h2 to h4 heading or its own empty
// block, or that puts content in a <Screen> with neither template, is a second
// look for the same job, so it fails here.
//
// The page files are read from the route tables: the route modules the web,
// extension popup (and side panel, which mounts the same tree) and desktop
// shells import, the extension approval window's kinds, and the Settings
// sub-page sections. Exceptions are counted per file in
// routeTemplates.allowlist.json with the reason they are not a page form, list
// or group title. The counts may only shrink: a file whose count drops fails
// until its entry is lowered or taken off.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const coreSrc = join(repoRoot, 'packages/core/src');
const allowlist = JSON.parse(readFileSync(join(repoRoot, 'test/unit/ui/routeTemplates.allowlist.json'), 'utf8'));

const SHELLS = [
    'packages/web/src/App.jsx',
    'packages/extension/src/popup/App.jsx',
    'packages/desktop/renderer/App.jsx',
];
const APPROVAL_ROUTER = 'packages/extension/src/approval/Router.jsx';
const SETTINGS_ROUTE = 'packages/core/src/shared/routes/Settings.jsx';

const rel = (path) => relative(repoRoot, path).split(sep).join('/');

function resolveModule(spec, fromFile) {
    let base;
    if (spec.startsWith('@xchain-wallet/core/')) base = join(coreSrc, spec.slice('@xchain-wallet/core/'.length));
    else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
    else return null;
    return [base, `${base}.jsx`, `${base}.js`].find((path) => /\.jsx?$/.test(path) && existsSync(path)) || null;
}

/** Module specifiers a file imports statically or through import(). */
export function importSpecs(source) {
    const specs = [];
    for (const match of source.matchAll(/\bfrom\s+'([^']+)'/g)) specs.push(match[1]);
    for (const match of source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) specs.push(match[1]);
    return specs;
}

/** Every page file the route tables reach, repo-relative and sorted. */
function pageFiles() {
    const pages = new Set();
    for (const shell of SHELLS) {
        const file = join(repoRoot, shell);
        for (const spec of importSpecs(readFileSync(file, 'utf8'))) {
            if (!/\/shared\/routes\//.test(spec)) continue;
            const path = resolveModule(spec, file);
            if (path) pages.add(rel(path));
        }
    }
    const router = join(repoRoot, APPROVAL_ROUTER);
    for (const spec of importSpecs(readFileSync(router, 'utf8'))) {
        if (!spec.startsWith('./kinds/')) continue;
        const path = resolveModule(spec, router);
        if (path) pages.add(rel(path));
    }
    const settings = join(repoRoot, SETTINGS_ROUTE);
    for (const spec of importSpecs(readFileSync(settings, 'utf8'))) {
        if (!/\/components\/settings\/\w+Section\.jsx$/.test(spec)) continue;
        const path = resolveModule(spec, settings);
        if (path) pages.add(rel(path));
    }
    return [...pages].sort();
}

/** Source with block, JSX and whole-line comments blanked, so prose never counts. */
function code(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

const count = (source, pattern) => (source.match(pattern) || []).length;

/**
 * What a page file draws by hand where a template belongs:
 *   form     a raw <form> element instead of FormPage
 *   heading  a raw h2, h3 or h4 instead of SectionHeader (or FormSection's title)
 *   empty    a className from an `empty...` style instead of EmptyState
 *   screen   a <Screen> whose file renders neither FormPage nor ListPage
 * Only non-zero counts are returned.
 */
export function templateGaps(source) {
    const body = code(source);
    const gaps = {
        form: count(body, /<form[\s>]/g),
        heading: count(body, /<h[234][\s>]/g),
        empty: count(body, /className=\{[^}]*\b\w+\.empty\w*/g),
        screen: /<Screen[\s>]/.test(body) && !/<(FormPage|ListPage)[\s>/]/.test(body) ? 1 : 0,
    };
    return Object.fromEntries(Object.entries(gaps).filter(([, n]) => n > 0));
}

const pages = pageFiles();
const found = Object.fromEntries(
    pages
        .map((path) => [path, templateGaps(readFileSync(join(repoRoot, path), 'utf8'))])
        .filter(([, gaps]) => Object.keys(gaps).length > 0),
);
const listed = Object.fromEntries(
    Object.entries(allowlist.files).map(([path, rules]) => [
        path,
        Object.fromEntries(Object.entries(rules).map(([rule, entry]) => [rule, entry.count])),
    ]),
);

describe('route templates', () => {
    it('recognizes a hand-drawn form, heading, empty block and untemplated screen, and leaves the templates alone', () => {
        const handDrawn = [
            '// <form> in a comment does not count',
            '/* nor <h2> here */',
            'export function Page() {',
            '    return (',
            '        <Screen header={header}>',
            '            <h2 className={styles.title}>Groups</h2>',
            '            <h3>Sub</h3>',
            '            <form onSubmit={submit}>',
            '                <p className={styles.emptyNote}>Nothing yet</p>',
            '            </form>',
            '        </Screen>',
            '    );',
            '}',
        ].join('\n');
        expect(templateGaps(handDrawn)).toEqual({ form: 1, heading: 2, empty: 1, screen: 1 });
        const templated = [
            'export function Page() {',
            '    return (',
            '        <Screen header={header}>',
            '            <ListPage>',
            '                <SectionHeader title="Groups" />',
            '                <EmptyState title="Nothing yet" />',
            '                <FormPage onSubmit={submit}><FormSection title="One" /></FormPage>',
            '            </ListPage>',
            '        </Screen>',
            '    );',
            '}',
        ].join('\n');
        expect(templateGaps(templated)).toEqual({});
        expect(importSpecs("import { A } from './a.jsx';\nconst B = lazy(() => import('./b.jsx'));")).toEqual(['./a.jsx', './b.jsx']);
    });

    it('reads the page files from the route tables', () => {
        expect(pages).toContain('packages/core/src/shared/routes/Send.jsx');
        expect(pages).toContain('packages/core/src/shared/routes/AddressList.jsx');
        expect(pages).toContain('packages/core/src/shared/routes/ConnectedSites.jsx');
        expect(pages).toContain('packages/extension/src/approval/kinds/SignApproval.jsx');
        expect(pages).toContain('packages/core/src/shared/components/settings/KeyboardSection.jsx');
        expect(pages.length).toBeGreaterThan(100);
    });

    it('draws every page form, list, empty state and group title through the templates, except where the allowlist names why', () => {
        expect(found, 'render through FormPage, ListPage, EmptyState or SectionHeader, or list the count with its reason; lower an entry when a count drops').toEqual(listed);
    });

    it('lists only page files the route tables reach', () => {
        expect(Object.keys(allowlist.files).filter((path) => !pages.includes(path))).toEqual([]);
    });

    it('gives every allowlist entry a reason', () => {
        for (const [path, rules] of Object.entries(allowlist.files)) {
            for (const [rule, entry] of Object.entries(rules)) {
                expect(['form', 'heading', 'empty', 'screen'], `${path} ${rule}`).toContain(rule);
                expect(Number.isInteger(entry.count) && entry.count > 0, `${path} ${rule}`).toBe(true);
                expect(typeof entry.reason === 'string' && entry.reason.length > 20, `${path} ${rule}`).toBe(true);
            }
        }
    });
});
