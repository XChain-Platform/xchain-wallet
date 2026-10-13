// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const routesDir = join(process.cwd(), 'packages/core/src/shared/routes');
const routeFiles = readdirSync(routesDir)
    .filter((name) => name.endsWith('.jsx'))
    .map((name) => join(routesDir, name));

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
        else if (value && typeof value === 'object') walk(value, visit);
    }
}

function references(node, identifier) {
    let found = false;
    walk(node, (child) => {
        if (child.type === 'Identifier' && child.name === identifier) found = true;
    });
    return found;
}

function attribute(element, name) {
    return element.openingElement.attributes.find(
        (item) => item.type === 'JSXAttribute' && item.name.name === name,
    );
}

// Where each local list is built: its initializer and every `name.push(...)`.
// A FormErrorSummary takes such a list, so the guard follows the list back
// to the form error it carries.
function listSources(ast) {
    const sources = new Map();
    const add = (name, node) => sources.set(name, [...(sources.get(name) || []), node]);
    walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
            add(node.id.name, node.init);
        }
        if (node.type === 'CallExpression'
            && node.callee.type === 'MemberExpression'
            && node.callee.object.type === 'Identifier'
            && node.callee.property.name === 'push') {
            node.arguments.forEach((arg) => add(node.callee.object.name, arg));
        }
    });
    return sources;
}

function referencesThroughLists(node, identifier, sources, seen = new Set()) {
    if (references(node, identifier)) return true;
    let found = false;
    walk(node, (child) => {
        if (found || child.type !== 'Identifier' || seen.has(child.name)) return;
        const origins = sources.get(child.name);
        if (!origins) return;
        seen.add(child.name);
        found = origins.some((origin) => referencesThroughLists(origin, identifier, sources, seen));
    });
    return found;
}

function isErrorStatus(element, identifier, sources = new Map()) {
    if (element.type !== 'JSXElement') return false;
    const name = element.openingElement.name.name;
    if (name === 'StatusMessage') {
        return attribute(element, 'variant')?.value?.value === 'error'
            && references(element, identifier);
    }
    // The linked validation summary: every field error, form errors included.
    if (name === 'FormErrorSummary') {
        const errors = attribute(element, 'errors');
        return Boolean(errors) && referencesThroughLists(errors.value, identifier, sources);
    }
    return false;
}

function formPages(file) {
    const source = readFileSync(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const sources = listSources(ast);
    const pages = [];
    walk(ast, (node) => {
        if (node.type === 'JSXElement' && node.openingElement.name.name === 'FormPage') {
            pages.push(Object.assign(node, { listSources: sources }));
        }
    });
    return pages;
}

function statusCarries(page, identifier) {
    const status = attribute(page, 'status');
    return Boolean(status) && referencesThroughLists(status, identifier, page.listSources);
}

describe('form-level error placement', () => {
    it('renders form and submit errors through FormPage status with StatusMessage', () => {
        const misplaced = [];
        const adHoc = [];

        for (const file of routeFiles) {
            for (const page of formPages(file)) {
                const status = attribute(page, 'status');
                for (const identifier of ['formError', 'submitError']) {
                    if (statusCarries(page, identifier)) {
                        let hasErrorStatus = false;
                        walk(status, (node) => {
                            if (isErrorStatus(node, identifier, page.listSources)) hasErrorStatus = true;
                        });
                        if (!hasErrorStatus) adHoc.push(`${basename(file)}:${page.loc.start.line}:${identifier}`);
                    }

                    for (const child of page.children) {
                        walk(child, (node) => {
                            if (isErrorStatus(node, identifier, page.listSources)) {
                                misplaced.push(`${basename(file)}:${node.loc.start.line}:${identifier}`);
                            }
                            if (node.type === 'JSXAttribute'
                                && node.name.name === 'error'
                                && references(node.value, identifier)) {
                                misplaced.push(`${basename(file)}:${node.loc.start.line}:${identifier}`);
                            }
                        });
                    }
                }
            }
        }

        expect(adHoc).toEqual([]);
        expect(misplaced).toEqual([]);
    });

    it('clears migrated form errors when an editable field changes', () => {
        const files = new Map([
            ['DispenserForm.jsx', 'setFormError'],
            ['IssueTokenForm.jsx', 'setFormError'],
            ['LinkForm.jsx', 'setFormError'],
            ['ListCreateForm.jsx', 'setFormError'],
            ['SellOwnershipForm.jsx', 'setFormError'],
            ['Send.jsx', 'setFormError'],
            ['StakeForm.jsx', 'setFormError'],
            ['SwapForm.jsx', 'setFormError'],
            ['TokenWizard.jsx', 'onEdit'],
        ]);

        for (const [name, clearHandler] of files) {
            const pages = formPages(join(routesDir, name));
            const candidates = pages.filter((candidate) => statusCarries(candidate, 'formError'));
            expect(candidates.length, `${name} formError status`).toBeGreaterThan(0);
            // A file may hold a read-only review page that shows formError with no
            // editable fields; the editable page is the one that must clear it.
            expect(
                candidates.some((page) => references(attribute(page, 'onChangeCapture'), clearHandler)),
                `${name} change clearing`,
            ).toBe(true);
            if (name === 'TokenWizard.jsx') {
                expect(readFileSync(join(routesDir, name), 'utf8')).toContain(
                    'onEdit: () => { if (formError) setFormError(null); }',
                );
            }
        }
    });
});
