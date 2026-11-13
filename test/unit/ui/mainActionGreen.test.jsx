// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The main action of every form is green: a submit Button draws the success
// variant unless it names another one, FormAction is always success, and a
// source scan holds every submit Button in the app to that line, with each
// exception listed here and given a reason.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import { FormAction } from '../../../packages/core/src/shared/components/formStandard/FormAction.jsx';
import styles from '../../../packages/core/src/ui/Button.module.css';

afterEach(cleanup);

describe('Button submit variant', () => {
    it('draws a submit with no variant, or primary, as success', () => {
        render(<><Button type="submit">Save</Button><Button type="submit" variant="primary">Go</Button></>);
        for (const name of ['Save', 'Go']) {
            const button = screen.getByRole('button', { name });
            expect(button).toHaveClass(styles.success);
            expect(button).not.toHaveClass(styles.primary);
        }
    });

    it('keeps the primary look on a plain button and every other variant on a submit', () => {
        render(<>
            <Button>Plain</Button>
            <Button type="submit" variant="danger">Remove</Button>
            <Button type="submit" variant="secondary">Other</Button>
        </>);
        expect(screen.getByRole('button', { name: 'Plain' })).toHaveClass(styles.primary);
        expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass(styles.danger);
        expect(screen.getByRole('button', { name: 'Other' })).toHaveClass(styles.secondary);
    });

    it('draws FormAction as success for both of its types', () => {
        render(<><FormAction>Send</FormAction><FormAction type="button">Next</FormAction></>);
        expect(screen.getByRole('button', { name: 'Send' })).toHaveClass(styles.success);
        expect(screen.getByRole('button', { name: 'Next' })).toHaveClass(styles.success);
    });
});

const root = process.cwd();
const files = execFileSync('git', ['-C', root, 'ls-files', 'packages/*.jsx'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !file.includes('/style-guide/'));

/** Every `<Name ...>` opening tag with its text, brace-aware so `=>` and `>` inside props do not end it. */
function openingTags(source, name) {
    const tags = [];
    const start = new RegExp(`<${name}\\b`, 'g');
    let match;
    while ((match = start.exec(source))) {
        let i = match.index + name.length + 1;
        let depth = 0;
        let quote = null;
        for (; i < source.length; i += 1) {
            const c = source[i];
            if (quote) { if (c === quote) quote = null; continue; }
            if (c === '"' || c === "'") { quote = c; continue; }
            if (c === '{') depth += 1;
            else if (c === '}') depth -= 1;
            else if (c === '>' && depth === 0) break;
        }
        tags.push({ text: source.slice(match.index, i + 1), line: source.slice(0, match.index).split('\n').length });
    }
    return tags;
}

// A submit that is not the form's forward action. Keyed by file and variant text.
const NOT_A_MAIN_ACTION = {
    'packages/core/src/shared/components/OpenOrdersPanel.jsx|danger': 'cancels open orders, a destructive action',
    'packages/core/src/shared/components/PlaceOrderPanel.jsx|{sideTone}': 'the order ticket takes the buy or sell side colour',
    'packages/core/src/shared/routes/CallbackForm.jsx|{isWatcherMode ? \'primary\' : \'danger\'}': 'destructive for a signing wallet, forward for a watcher',
    'packages/core/src/shared/routes/DestroyForm.jsx|{isWatcherMode ? \'primary\' : \'danger\'}': 'destroys an asset, destructive for a signing wallet',
    'packages/core/src/shared/routes/SweepForm.jsx|{isWatcherMode ? \'primary\' : \'danger\'}': 'sweeps a key off the wallet, destructive for a signing wallet',
    'packages/core/src/shared/routes/OracleForm.jsx|{needsTypedConfirm ? \'danger\' : \'primary\'}': 'danger while the typed confirmation is required',
    'packages/core/src/shared/routes/DispenserDetail.jsx|danger': 'closes a dispenser, a destructive action',
    'packages/core/src/shared/routes/DispenserExplorer.jsx|ghost': 'the magnifier inside the search field, not a form action',
};

describe('every submit Button is green or a listed exception', () => {
    it('finds submit buttons to hold to the rule', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('names no variant on a submit other than success, primary (drawn as success) or a listed exception', () => {
        const offenders = [];
        const used = new Set();
        for (const file of files) {
            const source = readFileSync(join(root, file), 'utf8');
            for (const tag of openingTags(source, 'Button')) {
                if (!/\btype=(?:"submit"|\{'submit'\})/.test(tag.text)) continue;
                const named = tag.text.match(/\bvariant=(?:"([a-z]+)"|(\{[^}]*(?:\{[^}]*\}[^}]*)*\}))/);
                const variant = named ? (named[1] || named[2]) : 'primary';
                if (variant === 'success' || variant === 'primary') continue;
                const key = `${file}|${variant}`;
                if (NOT_A_MAIN_ACTION[key]) { used.add(key); continue; }
                offenders.push(`${file}:${tag.line} variant ${variant}`);
            }
        }
        expect(offenders).toEqual([]);
        // An exception that no longer matches a submit is dead weight.
        expect([...used].sort()).toEqual(Object.keys(NOT_A_MAIN_ACTION).sort());
    });

    it('never gives FormAction a variant of its own', () => {
        const offenders = [];
        let found = 0;
        for (const file of files) {
            const source = readFileSync(join(root, file), 'utf8');
            for (const tag of openingTags(source, 'FormAction')) {
                found += 1;
                if (/\bvariant=/.test(tag.text)) offenders.push(`${file}:${tag.line}`);
            }
        }
        expect(found).toBeGreaterThan(40);
        expect(offenders).toEqual([]);
        expect(readFileSync(join(root, 'packages/core/src/shared/components/formStandard/FormAction.jsx'), 'utf8'))
            .toMatch(/<Button type=\{type\} variant="success" block/);
    });
});
