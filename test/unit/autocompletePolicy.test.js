// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';

const traverse = _traverse.default || _traverse;
const sources = import.meta.glob(
    ['../../packages/**/*.jsx', '!../../packages/**/node_modules/**'],
    { query: '?raw', import: 'default', eager: true },
);

function attributeValue(attribute, source) {
    if (!attribute) return '';
    if (!attribute.value) return 'true';
    if (attribute.value.type === 'StringLiteral') return attribute.value.value;
    if (attribute.value.type === 'JSXExpressionContainer') {
        return source.slice(attribute.value.expression.start, attribute.value.expression.end);
    }
    return '';
}

function controlsIn(source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const controls = [];
    traverse(ast, {
        JSXOpeningElement(path) {
            if (path.node.name.type !== 'JSXIdentifier') return;
            const tag = path.node.name.name;
            if (!['Input', 'input', 'Textarea', 'textarea'].includes(tag)) return;
            const attributes = Object.fromEntries(path.node.attributes
                .filter((attribute) => attribute.type === 'JSXAttribute')
                .map((attribute) => [
                    attribute.name.name,
                    attributeValue(attribute, source),
                ]));
            controls.push({ tag, attributes, line: path.node.loc.start.line });
        },
    });
    return controls;
}

const files = Object.fromEntries(Object.entries(sources).map(([path, source]) => [
    path,
    { source, controls: controlsIn(source) },
]));

function fileEnding(name) {
    return Object.entries(files).find(([path]) => path.endsWith(name))?.[1];
}

function control(file, value) {
    return fileEnding(file).controls.find((entry) => entry.attributes.value === value);
}

function description(path, entry) {
    return `${path}:${entry.line} <${entry.tag}>`;
}

describe('browser autocomplete policy', () => {
    it('classifies every password field explicitly', () => {
        const allowed = new Set(['current-password', 'new-password', 'off']);
        const failures = [];
        for (const [path, file] of Object.entries(files)) {
            for (const entry of file.controls) {
                if (!/password/.test(entry.attributes.type || '')) continue;
                if (!allowed.has(entry.attributes.autoComplete)) {
                    failures.push(description(path, entry));
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('uses new-password for wallet credentials being created', () => {
        const expected = [
            ['CreateWallet.jsx', 'password'],
            ['CreateWallet.jsx', 'confirm'],
            ['ImportWallet.jsx', 'password'],
            ['ImportWallet.jsx', 'confirm'],
            ['MigrateToBip39.jsx', 'password'],
            ['MigrateToBip39.jsx', 'confirm'],
            ['PairPartnerWallet.jsx', 'password'],
            ['PairPartnerWallet.jsx', 'confirm'],
        ];
        for (const [file, value] of expected) {
            expect(control(file, value)?.attributes.autoComplete, `${file}: ${value}`)
                .toBe('new-password');
        }
    });

    it('pairs the unlock password with a stable username token', () => {
        const locked = fileEnding('Locked.jsx');
        const password = control('Locked.jsx', 'password');
        const username = locked.controls.find((entry) => entry.attributes.name === 'username');
        expect(password?.attributes.autoComplete).toBe('current-password');
        expect(password?.attributes.name).toBe('password');
        expect(username?.attributes.type).toBe('text');
        expect(username?.attributes.value).toBe('xchain-wallet');
        expect(username?.attributes.autoComplete).toBe('username');
        expect(username?.attributes.readOnly).toBe('true');
        expect(username?.attributes.hidden).toBe('true');
    });

    it('keeps recovery material and private keys out of browser storage', () => {
        const failures = [];
        const ignoredTypes = new Set(['checkbox', 'file', 'number', 'radio']);
        for (const [path, file] of Object.entries(files)) {
            for (const entry of file.controls) {
                const text = Object.values(entry.attributes).join(' ');
                if (!/(mnemonic|recovery phrase|private key|\bwif\b|bip39.*passphrase)/i.test(text)) continue;
                if (ignoredTypes.has(entry.attributes.type)) continue;
                // The wallet-password gate on a reveal screen only mentions the key in its
                // hint; it is a real password field and stays current-password.
                if (entry.attributes.type === 'password' && /^wallet password$/i.test(entry.attributes.label || '')) continue;
                if (entry.attributes.autoComplete !== 'off') {
                    failures.push(description(path, entry));
                    continue;
                }
                if (/(mnemonic|recovery phrase|private key|\bwif\b)/i.test(text)
                    && entry.attributes.spellCheck !== 'false') {
                    failures.push(`${description(path, entry)} enables spellcheck`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('turns browser autocomplete off for address entry fields', () => {
        const failures = [];
        const ignoredTypes = new Set(['checkbox', 'file', 'number', 'radio']);
        for (const [path, file] of Object.entries(files)) {
            for (const entry of file.controls) {
                const { label = '', 'aria-label': ariaLabel = '', placeholder = '', id = '' } = entry.attributes;
                if (!/(address|recipient|destination|receive at)/i.test(`${label} ${ariaLabel} ${placeholder} ${id}`)) continue;
                if (ignoredTypes.has(entry.attributes.type)) continue;
                if (entry.attributes.autoComplete !== 'off') {
                    failures.push(description(path, entry));
                }
            }
        }
        expect(failures).toEqual([]);
    });
});
