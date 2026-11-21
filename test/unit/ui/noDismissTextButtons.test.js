// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// No notice, banner, toast or prompt carries a "Dismiss" text button (U100,
// 2026-11-21). Closing one is the Notice's corner X (G120): `onDismiss` on a
// Notice, whose accessible name may still say "Dismiss ...", but whose face
// shows no word. A second button stays only when it does something other
// than close.
//
// This scan reads every .jsx under packages/*/src and the desktop renderer
// and fails on a visible label that starts with "Dismiss":
//   - the children of a <Button> or <button>, literal text, a string literal
//     inside an expression, or a t('key') resolved through the English copy;
//   - a `label:` or `actionLabel:` in an object (a Notice action or recovery,
//     a toast action), literal or t('key');
//   - an `actionLabel=` attribute.
// Accessible names (aria-label, ariaLabel, dismissLabel) are not visible and
// are not read.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const PACKAGES = 'packages';

// Visible Dismiss labels that are not on a notice, each with the reason.
const ALLOWED = {
    // The Migrate to BIP39 list page's own action beside Finish: it stops the
    // page offering the swept-address list for good. A page action, not the
    // close control of a notice.
    'packages/core/src/shared/routes/MigrateToBip39.jsx': ['migration.dismissList'],
};

const DISMISS = /^\s*Dismiss\b/i;

function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (path.endsWith('.jsx')) out.push(path);
    }
    return out;
}

function sourceFiles() {
    const files = [];
    for (const pkg of readdirSync(PACKAGES)) {
        for (const sub of ['src', 'renderer']) {
            const dir = join(PACKAGES, pkg, sub);
            let isDir = false;
            try { isDir = statSync(dir).isDirectory(); } catch { /* absent */ }
            if (isDir) walk(dir, files);
        }
    }
    return files.map((f) => relative('.', f).split('\\').join('/'));
}

/** The English text for `t('key')`, or null for a key with no copy. */
function copy(key) {
    return typeof en[key] === 'string' ? en[key] : null;
}

/** Index just past the `>` that ends the JSX opening tag starting at `from`. */
function endOfOpeningTag(src, from) {
    let depth = 0;
    let quote = null;
    for (let i = from; i < src.length; i += 1) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i += 1;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return { end: i + 1, selfClosing: src[i - 1] === '/' };
    }
    return null;
}

/** Each visible label the children of a button carry, with any t() key. */
function childLabels(children) {
    const labels = [];
    const text = children.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    for (const m of text.matchAll(/\bt\(\s*(['"])([\w.-]+)\1/g)) {
        labels.push({ text: copy(m[2]) || '', key: m[2] });
    }
    for (const m of text.matchAll(/\{[^{}]*\}/g)) {
        for (const s of m[0].matchAll(/(['"`])((?:(?!\1).)*)\1/g)) labels.push({ text: s[2], key: null });
    }
    const bare = text.replace(/\{[^{}]*\}/g, ' ').replace(/<[^>]*>/g, ' ').trim();
    if (bare) labels.push({ text: bare, key: null });
    return labels;
}

function findings(file, src) {
    const found = [];
    const add = (label, where) => {
        if (!DISMISS.test(label.text)) return;
        if (label.key && (ALLOWED[file] || []).includes(label.key)) return;
        const line = src.slice(0, where).split('\n').length;
        found.push(`${file}:${line} "${label.text.trim()}"${label.key ? ` (${label.key})` : ''}`);
    };

    for (const m of src.matchAll(/<(Button|button)\b/g)) {
        const open = endOfOpeningTag(src, m.index + m[0].length);
        if (!open || open.selfClosing) continue;
        const close = src.indexOf(`</${m[1]}>`, open.end);
        if (close < 0) continue;
        for (const label of childLabels(src.slice(open.end, close))) add(label, m.index);
    }

    for (const m of src.matchAll(/(?:\b(?:label|actionLabel)\s*:|\bactionLabel=\{?)\s*(?:(['"`])((?:(?!\1).)*)\1|t\(\s*(['"])([\w.-]+)\3)/g)) {
        if (m[2] !== undefined) add({ text: m[2], key: null }, m.index);
        else add({ text: copy(m[4]) || '', key: m[4] }, m.index);
    }
    return found;
}

describe('no Dismiss text buttons (U100)', () => {
    const files = sourceFiles();

    it('reads the shell renderers and every package source tree', () => {
        expect(files).toContain('packages/desktop/renderer/DesktopUpdateBanner.jsx');
        expect(files).toContain('packages/core/src/ui/StatusMessage.jsx');
        expect(files.some((f) => f.startsWith('packages/web/src/'))).toBe(true);
        expect(files.some((f) => f.startsWith('packages/extension/src/'))).toBe(true);
    });

    it('finds no visible label that starts with Dismiss', () => {
        const all = files.flatMap((file) => findings(file, readFileSync(file, 'utf8')));
        expect(all).toEqual([]);
    });

    it('keeps each allowed label in use, so a stale exception cannot linger', () => {
        for (const [file, keys] of Object.entries(ALLOWED)) {
            const src = readFileSync(file, 'utf8');
            for (const key of keys) expect(src, `${file} ${key}`).toContain(`t('${key}')`);
        }
    });

    it('catches each shape it guards against', () => {
        const shapes = {
            'a.jsx': "<Button onClick={() => close()}>\n    Dismiss\n</Button>",
            'b.jsx': "<Button size=\"sm\" onClick={() => go(a > b)}>{t('desktopUpdate.dismissLabel')}</Button>",
            'c.jsx': "<Notice recovery={{ label: 'Dismiss', onAction: close }}>x</Notice>",
            'd.jsx': "<Notice recovery={{ label: t('shell.dismiss'), onAction: close }}>x</Notice>",
            'e.jsx': "showToast({ message: 'x', actionLabel: 'Dismiss' });",
            'f.jsx': "<button type=\"button\">{busy ? 'Closing' : 'Dismiss'}</button>",
        };
        for (const [file, src] of Object.entries(shapes)) {
            expect(findings(file, src), file).toHaveLength(1);
        }
        const fine = [
            "<Notice onDismiss={close} dismissLabel=\"Dismiss update notice\">x</Notice>",
            "<Button aria-label=\"Dismiss notification\" icon={<XIcon />} onClick={close} />",
            "<Button ariaLabel={t('shell.dismiss')} onClick={close}>Remind Me Tomorrow</Button>",
            "<Notice action={{ label: 'Open Backup', ariaLabel: 'Dismiss', onAction: open }}>x</Notice>",
        ];
        for (const src of fine) expect(findings('ok.jsx', src), src).toEqual([]);
    });
});
