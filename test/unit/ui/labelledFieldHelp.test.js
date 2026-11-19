// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ruling 2026-11-13: every label that has a field with it shows the '?' help
// tip (the kit InfoTip, reached through the field component's `help` prop).
// formFieldHelp.test.js reads only the transaction forms (files with a
// FormFrame), which is how Receive (a FormPage) and the settings, wallet and
// key screens kept fields without one. This scan reads every .jsx under
// packages/core/src. A labelled field without help is listed below with its
// reason, and a listed entry that no longer matches a field fails, so the
// list stays true.
//
// The one field with no tip by ruling is the memo inside a MemoSection,
// which draws no label row at all (formFieldHelp.test.js pins it). A field
// whose label is visually hidden, or that has only a placeholder or an
// aria-label, is not a labelled field and is not read here.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const SRC = 'packages/core/src';

// Field components whose label row draws the InfoTip from a `help` prop.
// FeeSelector and DurationSlider are left out: their label rows always draw
// their own tip.
const FIELDS = new Set([
    'Input', 'Select', 'Textarea', 'TokenField', 'AddressField', 'AddressCombobox',
    'IconSelect', 'RadioGroup', 'Checkbox', 'Switch', 'NetworkField', 'AmountField',
    'FileField', 'OwnershipToggle', 'ListField', 'TargetField', 'UrlField',
    'QuickAddressRow', 'SettingsFieldRow', 'ToggleRow',
]);

// Components that carry a visible default label when the caller passes none.
const DEFAULT_LABEL = { TokenField: 'Token', AmountField: 'Amount', NetworkField: 'Network' };

// Files other work is rewriting right now (2026-11-13: the orders, swaps and
// bet market pages and the new detail-page components). Their fields are
// read and reported but not failed on, since their labels are still moving.
// Remove each entry once that work lands and its fields carry help.
const PENDING = {
    'shared/routes/MyOrdersView.jsx': 'My Orders page, under rework.',
    'shared/routes/MySwapsView.jsx': 'My Swaps page, under rework.',
    'shared/routes/BetFeedDetail.jsx': 'Bet Market detail page, under rework.',
    'shared/routes/SwapDetail.jsx': 'New Swap detail page, under construction.',
};

// Labelled fields that need no help of their own, keyed file|component|label source.
const NO_HELP = {
    "shared/routes/ImportWallet.jsx|FileField|t('importWallet.backup.choose')":
        'The Backup tab\'s drop area: its title is the instruction itself, and the picked layout (restore-v2) draws no ? tip.',
    'ui/AddressField.jsx|Input|label':
        'The kit AddressField draws its label through Input and forwards the caller\'s help through ...rest.',
    'ui/AddressCombobox.jsx|Input|label':
        'The kit AddressCombobox draws its label through Input and forwards the caller\'s help through ...rest.',
    'shared/routes/CrossChainOrderForm.jsx|TokenField|(Token)':
        'The TokenField inside the local TokenFieldWithHelp wrapper, which draws the help tip itself.',
    'shared/components/FeesCard.jsx|Switch|<span className={styles.visuallyHidden}> {t(\'flo':
        'The pay-in-coin switch has a visually hidden label; its fee row names it.',
    'shared/routes/ListCreateForm.jsx|Checkbox|unionCandidateName(candidate)':
        'One list in the union member-list pick list; each row names the list it adds.',
    'shared/routes/PollDetail.jsx|Checkbox|<span className={detailStyles.optionLabel}>{i}: ':
        'One ballot option in the ballot group, whose label row carries the help.',
    'shared/routes/ControllerBindForm.jsx|Checkbox|<span className={styles.actionClassLabel}> <span':
        'One class in the Action class group, whose legend carries the one help tip (operator 2026-11-14).',
    'shared/components/outcomeDetail/OutcomeDetailLayout.jsx|Checkbox|option.label':
        'One option in the OutcomePick group, whose head (the group legend) draws the page\'s help tip.',
    'shared/components/formStandard/AdvancedSection.jsx|Checkbox|<span className={styles.coinControlValue}> <span':
        'One coin in the coin-control list; the Coin control switch above carries the help.',
    'shared/routes/OracleRecord.jsx|Select|Status':
        'The Status filter inside the title-bar filter panel (G04), a list filter rather than a form field.',
    'shared/routes/CoSignerPolicyEditor.jsx|Checkbox|label':
        'One action in the Allowed actions group, whose Actions label carries the help.',
    'shared/routes/History.jsx|Checkbox|label':
        'One column in the export Columns group, whose legend carries the help.',
    'shared/routes/AlertsRoute.jsx|Checkbox|<span className={styles.typeOption}><span classN':
        'The Unread option in the filter panel\'s type group, whose legend carries the help.',
    'shared/routes/AlertsRoute.jsx|Checkbox|<span className={styles.typeOption}><TypeIcon />':
        'One alert type in the filter panel\'s type group, whose legend carries the help.',
};

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, out);
        else if (entry.name.endsWith('.jsx')) out.push(path);
    }
    return out;
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

// A long JSX label is keyed by its opening text only, so an edit deeper in
// that label does not unhook its listed reason.
const short = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 48);

function hasInfoTip(node) {
    let found = false;
    visit(node, (child) => {
        if (child.type === 'JSXOpeningElement' && child.name.name === 'InfoTip') found = true;
    });
    return found;
}

function isDisplayOnly(node, attrs) {
    const staticallyTrue = (name) => {
        const value = attrs.get(name);
        return value === null || (
            value?.type === 'JSXExpressionContainer'
            && value.expression.type === 'BooleanLiteral'
            && value.expression.value === true
        );
    };
    const hasSpread = node.attributes.some((attr) => attr.type === 'JSXSpreadAttribute');
    const hasFieldHandler = node.attributes.some((attr) => (
        attr.type === 'JSXAttribute'
        && /^on[A-Z]/.test(attr.name.name)
    ));
    // G121: help belongs only beside editable fields. A permanently read-only
    // or disabled display, including a derived value with no edit signal, is exempt.
    if (staticallyTrue('readOnly')) return 'readOnly';
    if (staticallyTrue('disabled')) return 'disabled';
    if (attrs.has('value') && !hasSpread && !hasFieldHandler) return 'derived';
    return null;
}

/** Labelled fields in one source, each with whether it carries help. */
function fieldsInSource(source, rel) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const out = [];
    // A field drawn with an InfoTip as its very next sibling (the passphrase
    // switches on Create and Import wallet) shows the tip beside its label.
    const siblingTipped = new Set();
    visit(ast.program, (node) => {
        if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
        const kids = node.children.filter((child) => !(child.type === 'JSXText' && child.value.trim() === ''));
        kids.forEach((child, index) => {
            const next = kids[index + 1];
            if (child.type === 'JSXElement' && next?.type === 'JSXElement' && next.openingElement.name.name === 'InfoTip') {
                siblingTipped.add(child.openingElement.start);
            }
        });
    });
    visit(ast.program, (node) => {
        if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return;
        const component = node.name.name;
        if (component !== 'FromSection' && !FIELDS.has(component)) return;
        const attrs = new Map();
        for (const attr of node.attributes) {
            if (attr.type === 'JSXAttribute') attrs.set(attr.name.name, attr.value);
        }
        const text = (value) => (value ? short(source.slice(
            value.type === 'JSXExpressionContainer' ? value.expression.start : value.start + 1,
            value.type === 'JSXExpressionContainer' ? value.expression.end : value.end - 1,
        )) : null);
        const empty = (expr) => expr.type === 'NullLiteral'
            || (expr.type === 'Identifier' && expr.name === 'undefined')
            || (expr.type === 'StringLiteral' && expr.value.trim() === '');
        const given = (name) => {
            const value = attrs.get(name);
            if (value === undefined) return false;
            if (value === null) return true;
            if (value.type === 'StringLiteral') return value.value.trim() !== '';
            const expr = value.expression;
            // Help that one branch of a condition drops leaves the field
            // without a tip in that state, so it counts as missing.
            if (name === 'help' && expr.type === 'ConditionalExpression') {
                return !empty(expr.consequent) && !empty(expr.alternate);
            }
            return !empty(expr);
        };
        const line = node.loc.start.line;
        if (component === 'FromSection') {
            out.push({ rel, line, key: `${rel}|FromSection.network|${text(attrs.get('networkLabel')) ?? '(Network)'}`, help: given('networkHelp') });
            out.push({ rel, line, key: `${rel}|FromSection.address|${text(attrs.get('addressLabel')) ?? '(From address)'}`, help: given('addressHelp') });
            return;
        }
        const labelProp = component === 'RadioGroup' ? 'legend' : 'label';
        let label = given(labelProp) ? text(attrs.get(labelProp)) : null;
        if (!attrs.has(labelProp) && DEFAULT_LABEL[component]) label = `(${DEFAULT_LABEL[component]})`;
        if (label === null) return;
        const labelValue = attrs.get(labelProp);
        const help = given('help') || Boolean(labelValue && hasInfoTip(labelValue)) || siblingTipped.has(node.start);
        out.push({
            rel,
            line,
            key: `${rel}|${component}|${label}`,
            help,
            displayOnly: isDisplayOnly(node, attrs),
        });
    });
    return out;
}

function fieldsIn(file) {
    return fieldsInSource(readFileSync(file, 'utf8'), relative(SRC, file));
}

const files = walk(SRC).sort();
const fields = files.flatMap(fieldsIn);
const unhelped = fields.filter((field) => !field.help && !field.displayOnly);
const pendingMissing = unhelped.filter((field) => field.rel in PENDING);
const failing = unhelped.filter((field) => !(field.rel in PENDING));

describe('labelled field help across the wallet', () => {
    it('reads every wallet component and route', () => {
        expect(files.length).toBeGreaterThan(300);
        expect(fields.length).toBeGreaterThan(600);
        for (const name of ['routes/Receive.jsx', 'routes/Locked.jsx', 'components/settings/PrivacySection.jsx', 'ui/Input.jsx']) {
            expect(files.some((file) => file.endsWith(name)), name).toBe(true);
        }
    });

    it('gives every labelled field a ? help tip or a listed reason', () => {
        const missing = failing
            .filter((field) => !(field.key in NO_HELP))
            .map((field) => `${field.key} (line ${field.line})`);
        expect(missing).toEqual([]);
    });

    it('finds the Receive address and asset fields with their help', () => {
        const receive = fields.filter((field) => field.rel === 'shared/routes/Receive.jsx');
        const address = receive.find((field) => field.key.startsWith('shared/routes/Receive.jsx|AddressField|'));
        const asset = receive.find((field) => field.key.startsWith('shared/routes/Receive.jsx|TokenField|'));
        expect(address?.help).toBe(true);
        expect(asset?.help).toBe(true);
    });

    it('exempts the derived Import Wallet address under G121', () => {
        const address = fields.find((field) => (
            field.key === "shared/routes/ImportWallet.jsx|Input|t('verifySignature.address')"
        ));
        expect(address).toMatchObject({ help: false, displayOnly: 'readOnly' });
    });

    it('recognises only real display-only signals', () => {
        const samples = fieldsInSource(`const fields = <>
            <Input label="Read only" readOnly />
            <TokenField label="Disabled" disabled />
            <Input label="Derived" value={derivedValue} />
            <Input label="Editable" value={editableValue} onChange={setEditableValue} />
        </>;`, 'guard-samples.jsx');
        expect(samples.map(({ displayOnly }) => displayOnly)).toEqual([
            'readOnly', 'disabled', 'derived', null,
        ]);
    });

    it('lists only fields that still exist without help, each with a reason', () => {
        const unhelpedKeys = new Set(failing.map((field) => field.key));
        const stale = Object.keys(NO_HELP).filter((key) => !unhelpedKeys.has(key));
        expect(stale).toEqual([]);
        for (const reason of Object.values(NO_HELP)) expect(reason.trim().length).toBeGreaterThan(20);
    });

    it('keeps the pending list to files that exist, each with a reason', () => {
        for (const [rel, reason] of Object.entries(PENDING)) {
            expect(existsSync(join(SRC, rel)), rel).toBe(true);
            expect(reason.trim().length).toBeGreaterThan(10);
        }
        // The pending files' fields without help, for the session that owns them.
        expect(Array.isArray(pendingMissing)).toBe(true);
    });
});
