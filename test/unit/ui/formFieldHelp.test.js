// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every labelled field on a transaction form carries the label-row '?' help,
// written for that field on that form. The scan reads each form's source:
// a field component with a visible label must pass `help` (FromSection
// passes `networkHelp` and `addressHelp`), or name an InfoTip inside its
// label. A field that needs no help is listed below with the reason, and a
// listed entry that no longer matches a field fails, so the list stays true.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const SHARED = 'packages/core/src/shared';

// Field components that draw the label-row InfoTip from a `help` prop.
const FIELDS = new Set([
    'Input', 'Select', 'Textarea', 'TokenField', 'AddressField', 'AddressCombobox',
    'IconSelect', 'RadioGroup', 'Checkbox', 'Switch', 'NetworkField', 'AmountField',
    'FileField', 'OwnershipToggle',
]);

// Components that carry a visible default label when the form passes none.
const DEFAULT_LABEL = { TokenField: 'Token', AmountField: 'Amount', NetworkField: 'Network' };

// Pieces a form renders inside its own sections: their fields are the form's.
const FORM_PARTS = [
    'components/DurationSlider.jsx',
    'components/FeesCard.jsx',
    'components/TickItemsEditor.jsx',
    'components/TileLookFields.jsx',
    'components/formStandard/AdvancedSection.jsx',
    'routes/SignerSelectForm.jsx',
];

// Fields that need no help of their own, keyed form|component|label source.
const NO_HELP = {
    'routes/PollDetail.jsx|Checkbox|<span className={detailStyles.optionLabel}>{i}: ':
        'One ballot option in the ballot group, whose label row carries the help.',
    'components/formStandard/AdvancedSection.jsx|Checkbox|<span className={styles.coinControlValue}> <span':
        'One coin in the coin-control list; the Coin control switch above carries the help.',
    'routes/ListCreateForm.jsx|Checkbox|unionCandidateName(candidate)':
        'One list in the union member-list pick list; each row names the list it adds.',
    'routes/ControllerBindForm.jsx|Checkbox|<span className={styles.actionClassLabel}> <span':
        'One class in the Action class group, whose legend carries the one help tip (operator 2026-11-14).',
    'routes/CrossChainOrderForm.jsx|TokenField|(Token)':
        'The TokenField inside the local TokenFieldWithHelp wrapper, which draws the help tip itself.',
    'components/FeesCard.jsx|Switch|<span className={styles.visuallyHidden}> {t(\'flo':
        'The pay-in-coin switch has no visible label; its fee row names it.',
};

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (entry.name.endsWith('.jsx')) out.push(path);
    }
    return out;
}

function formFiles() {
    const forms = walk(SHARED)
        .filter((path) => !path.includes('/formStandard/'))
        .filter((path) => /<FormFrame[\s>]/.test(readFileSync(path, 'utf8')));
    return [...new Set([...forms, ...FORM_PARTS.map((part) => join(SHARED, part))])].sort();
}

function visit(node, fn) {
    if (!node || typeof node.type !== 'string') return;
    fn(node);
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach((child) => visit(child, fn));
        else if (value && typeof value.type === 'string') visit(value, fn);
    }
}

// A long JSX label is keyed by its opening text only, so another edit deeper
// in that label does not unhook its listed reason.
const short = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 48);

function hasInfoTip(node) {
    let found = false;
    visit(node, (child) => {
        if (child.type === 'JSXOpeningElement' && child.name.name === 'InfoTip') found = true;
    });
    return found;
}

/** Labelled fields in one source, each with whether it carries help. */
function fieldsIn(file) {
    const source = readFileSync(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const rel = relative(SHARED, file);
    const out = [];
    visit(ast.program, (node) => {
        if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return;
        const component = node.name.name;
        if (component !== 'FromSection' && !FIELDS.has(component)) return;
        const attrs = new Map();
        let spread = false;
        for (const attr of node.attributes) {
            if (attr.type === 'JSXSpreadAttribute') spread = true;
            else attrs.set(attr.name.name, attr.value);
        }
        const text = (value) => (value ? short(source.slice(
            value.type === 'JSXExpressionContainer' ? value.expression.start : value.start + 1,
            value.type === 'JSXExpressionContainer' ? value.expression.end : value.end - 1,
        )) : null);
        const given = (name) => {
            const value = attrs.get(name);
            if (value === undefined) return false;
            if (value === null) return true;
            if (value.type === 'StringLiteral') return value.value.trim() !== '';
            const expr = value.expression;
            return !(expr.type === 'NullLiteral' || (expr.type === 'Identifier' && expr.name === 'undefined'));
        };
        const line = node.loc.start.line;
        if (component === 'FromSection') {
            // The section's own spread binds open state only, so help is read
            // from its named props.
            out.push({
                key: `${rel}|FromSection.network|${text(attrs.get('networkLabel')) ?? '(Network)'}`,
                line,
                help: given('networkHelp'),
            });
            out.push({
                key: `${rel}|FromSection.address|${text(attrs.get('addressLabel')) ?? '(From address)'}`,
                line,
                help: given('addressHelp'),
            });
            return;
        }
        const labelProp = component === 'RadioGroup' ? 'legend' : 'label';
        let label = given(labelProp) ? text(attrs.get(labelProp)) : null;
        if (!attrs.has(labelProp) && DEFAULT_LABEL[component]) label = `(${DEFAULT_LABEL[component]})`;
        if (label === null) return;
        const labelValue = attrs.get(labelProp);
        // Help a spread might carry is not visible here, so such a field
        // counts as missing until it names `help` or is listed.
        const help = given('help') || Boolean(labelValue && hasInfoTip(labelValue));
        out.push({ key: `${rel}|${component}|${label}`, line, help, spread });
    });
    return out;
}

const files = formFiles();
const fields = files.flatMap(fieldsIn);
const unhelped = fields.filter((field) => !field.help);

describe('transaction form field help', () => {
    it('reads every transaction form', () => {
        expect(files.length).toBeGreaterThan(55);
        expect(fields.length).toBeGreaterThan(350);
        expect(files.some((file) => file.endsWith('routes/Send.jsx'))).toBe(true);
    });

    it('gives every labelled field a ? help tip or a listed reason', () => {
        const missing = unhelped
            .filter((field) => !(field.key in NO_HELP))
            .map((field) => `${field.key} (line ${field.line})`);
        expect(missing).toEqual([]);
    });

    // The one field with no ? tip by ruling (2026-11-13): a memo alone in its
    // Memo section. The section title already says Memo, so MemoSection draws
    // the field with no label row (no second Memo, no tip) and puts the count
    // in the header. A Memo section with more in it keeps labelled fields.
    it('draws a memo alone in its Memo section through MemoSection, with no label or tip', () => {
        const handRolled = [];
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
            visit(ast.program, (node) => {
                if (node.type !== 'JSXElement' || node.openingElement.name.name !== 'FormSection') return;
                const idAttr = node.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'id');
                if (idAttr?.value?.value !== 'memo') return;
                const fields = [];
                visit({ type: 'Body', children: node.children }, (child) => {
                    if (child.type === 'JSXOpeningElement' && FIELDS.has(child.name.name)) fields.push(child.name.name);
                });
                if (fields.length === 1 && fields[0] === 'Input') {
                    handRolled.push(`${relative(SHARED, file)}:${node.loc.start.line}`);
                }
            });
        }
        expect(handRolled).toEqual([]);

        const memoSource = readFileSync(join(SHARED, 'components/formStandard/MemoSection.jsx'), 'utf8');
        const memoAst = parse(memoSource, { sourceType: 'module', plugins: ['jsx'] });
        const inputs = [];
        visit(memoAst.program, (node) => {
            // The memo is an auto-growing Textarea (one line, up to three).
            if (node.type === 'JSXOpeningElement' && ['Input', 'Textarea'].includes(node.name.name)) inputs.push(node);
        });
        expect(inputs).toHaveLength(1);
        expect(inputs[0].name.name).toBe('Textarea');
        const names = inputs[0].attributes.filter((a) => a.type === 'JSXAttribute').map((a) => a.name.name);
        expect(names).not.toContain('label');
        expect(names).not.toContain('help');
        expect(names).toContain('aria-label');
        expect(names).toContain('maxLength');
        expect(names).toContain('autoGrow');
    });

    it('lists only fields that still exist without help, each with a reason', () => {
        const unhelpedKeys = new Set(unhelped.map((field) => field.key));
        const stale = Object.keys(NO_HELP).filter((key) => !unhelpedKeys.has(key));
        expect(stale).toEqual([]);
        for (const reason of Object.values(NO_HELP)) expect(reason.trim().length).toBeGreaterThan(20);
    });
});
