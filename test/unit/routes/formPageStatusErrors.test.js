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

function isErrorStatus(element, identifier) {
    return element.type === 'JSXElement'
        && element.openingElement.name.name === 'StatusMessage'
        && attribute(element, 'variant')?.value?.value === 'error'
        && references(element, identifier);
}

function formPages(file) {
    const source = readFileSync(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const pages = [];
    walk(ast, (node) => {
        if (node.type === 'JSXElement' && node.openingElement.name.name === 'FormPage') pages.push(node);
    });
    return pages;
}

describe('form-level error placement', () => {
    it('renders form and submit errors through FormPage status with StatusMessage', () => {
        const misplaced = [];
        const adHoc = [];

        for (const file of routeFiles) {
            for (const page of formPages(file)) {
                const status = attribute(page, 'status');
                for (const identifier of ['formError', 'submitError']) {
                    if (references(status, identifier)) {
                        let hasErrorStatus = false;
                        walk(status, (node) => {
                            if (isErrorStatus(node, identifier)) hasErrorStatus = true;
                        });
                        if (!hasErrorStatus) adHoc.push(`${basename(file)}:${page.loc.start.line}:${identifier}`);
                    }

                    for (const child of page.children) {
                        walk(child, (node) => {
                            if (isErrorStatus(node, identifier)) {
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
            const page = pages.find((candidate) => references(attribute(candidate, 'status'), 'formError'));
            expect(page, `${name} formError status`).toBeTruthy();
            expect(
                references(attribute(page, 'onChangeCapture'), clearHandler),
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
