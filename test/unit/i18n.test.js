// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
    getLocale,
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';

const traverse = _traverse.default || _traverse;
const TEST_LOCALE = 'unit-partial';
const TRANSLATION_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const sharedSources = import.meta.glob(
    '../../packages/core/src/shared/**/*.{js,jsx}',
    { query: '?raw', import: 'default', eager: true },
);

function translationUsage(source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    let importsT = false;
    const keys = new Set();

    traverse(ast, {
        ImportDeclaration(path) {
            if (!path.node.source.value.endsWith('/i18n/index.js')) return;
            importsT = path.node.specifiers.some((specifier) => (
                specifier.type === 'ImportSpecifier' && specifier.imported.name === 't'
            ));
        },
        StringLiteral(path) {
            if (TRANSLATION_KEY.test(path.node.value)) keys.add(path.node.value);
        },
        TemplateLiteral(path) {
            if (path.node.expressions.length !== 0) return;
            const value = path.node.quasis[0]?.value.cooked;
            if (value && TRANSLATION_KEY.test(value)) keys.add(value);
        },
    });

    return { importsT, keys: importsT ? keys : new Set() };
}

function missingTranslationKeys(keys, dictionary) {
    return [...keys].filter((key) => typeof dictionary[key] !== 'string').sort();
}

beforeEach(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

afterAll(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

describe('translations', () => {
    it('looks up English keys and exposes unknown keys', () => {
        expect(t('scan.title')).toBe('Scan');
        expect(t('missing.unit.key')).toBe('missing.unit.key');
    });

    it('falls back to English when the active locale omits a key', async () => {
        registerLocale(TEST_LOCALE, { 'common.back': 'Retour' });
        await setLocale(TEST_LOCALE);

        expect(t('common.back')).toBe('Retour');
        expect(t('scan.title')).toBe('Scan');
    });

    it('interpolates message variables', () => {
        expect(t('pending.detail.firstSeen', { when: 'just now' }))
            .toBe('First seen by the network just now');
    });

    it('selects singular and plural forms', async () => {
        registerLocale(TEST_LOCALE, {
            'test.addressCount': '{count, plural, one {# address} other {# addresses}}',
        });
        await setLocale(TEST_LOCALE);

        expect(t('test.addressCount', { count: 1 })).toBe('1 address');
        expect(t('test.addressCount', { count: 2 })).toBe('2 addresses');
    });

    it.each([
        [0, '0 addresses', '0 actions', '0% of supply and at least 0 voters.', ' It runs 0 blocks after the poll closes.', '0 state keys. Tap Expand to view.', 'tokens', '0 tokens', '0 blocks', '0 files'],
        [1, '1 address', '1 action', '1% of supply and at least 1 voter.', ' It runs 1 block after the poll closes.', '1 state key. Tap Expand to view.', 'token', '1 token', '1 block', '1 file'],
        [3, '3 addresses', '3 actions', '3% of supply and at least 3 voters.', ' It runs 3 blocks after the poll closes.', '3 state keys. Tap Expand to view.', 'tokens', '3 tokens', '3 blocks', '3 files'],
    ])('pluralizes inline count copy for %i', (count, addresses, actions, turnout, delay, stateKeys, tokenNoun, tokenCount, blockCount, fileCount) => {
        expect(t('cosigner.allowedRecipientCount', { count })).toBe(addresses);
        expect(t('cosigner.windowActionCount', { count })).toBe(actions);
        expect(t('cosigner.rollingActionLimit', { count, hours: 24 })).toBe(`${actions} per 24h`);
        expect(t('governance.poll.turnout', { quorum: `${count}%`, count })).toBe(turnout);
        expect(t('governance.poll.callbackDelay', { count })).toBe(delay);
        expect(t('contracts.stateKeyCount', { count })).toBe(stateKeys);
        expect(t('airdrop.underlyingTokenNoun', { count })).toBe(tokenNoun);
        expect(t('airdrop.holderCountsUnavailable', { count }))
            .toBe(`Holder counts unavailable for ${tokenCount}`);
        expect(t('airdrop.someHolderCountsUnavailable', { failed: count, total: count }))
            .toBe(`Holder counts unavailable for ${count} of ${tokenCount}`);
        expect(t('sleep.durationBlocks', { count })).toBe(blockCount);
        expect(t('tokenDetail.fileCount', { count })).toBe(fileCount);
    });

    it.each([
        [0, '0 / 10 characters.', 'Total: 5 XCP across 0 recipients, in one transaction and one network fee.', '0 recipients are the most one send carries. Use an airdrop to distribute to a longer list.', '0 of 0 history items shown', '0 Confirmations'],
        [1, '1 / 10 character.', 'Total: 5 XCP across 1 recipient, in one transaction and one network fee.', '1 recipient is the most one send carries. Use an airdrop to distribute to a longer list.', '1 of 1 history item shown', '1 Confirmation'],
        [3, '3 / 10 characters.', 'Total: 5 XCP across 3 recipients, in one transaction and one network fee.', '3 recipients are the most one send carries. Use an airdrop to distribute to a longer list.', '3 of 3 history items shown', '3 Confirmations'],
    ])('pluralizes translated count copy for %i', (count, memo, recipients, maximum, shown, confirmations) => {
        expect(t('send.memoCount', { used: count, max: 10 })).toBe(memo);
        expect(t('send.recipient.total', { total: '5 XCP', count })).toBe(recipients);
        expect(t('send.recipient.maximum', { count })).toBe(maximum);
        expect(t('history.itemsShown', { shown: count, total: count })).toBe(shown);
        expect(t('history.row.confirmations', { count })).toBe(confirmations);
    });

    it.each([
        [0, '0 gated content packs', 'packs'],
        [1, '1 gated content pack', 'pack'],
        [3, '3 gated content packs', 'packs'],
    ])('pluralizes gated pack counts for %i', (count, totalCopy, missingCopy) => {
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`has ${totalCopy}`);
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`missing ${missingCopy}:`);
    });

    it('reports a table-driven key from a new namespace as missing', () => {
        const source = `
            import { t } from '../../i18n/index.js';
            const COPY = { ready: 'status.ready', failed: \`status.failed\` };
            t(COPY.ready);
        `;

        const { keys } = translationUsage(source);

        expect(Object.keys(en).some((key) => key.startsWith('status.'))).toBe(false);
        expect([...keys].sort()).toEqual(['status.failed', 'status.ready']);
        expect(missingTranslationKeys(keys, { 'status.ready': 'Ready' }))
            .toEqual(['status.failed']);
    });

    it('defines every translation key used by shared code in English', () => {
        const translatedFiles = [];
        const usedKeys = new Set();

        for (const [file, source] of Object.entries(sharedSources)) {
            const usage = translationUsage(source);
            if (!usage.importsT) continue;
            translatedFiles.push(file);
            for (const key of usage.keys) usedKeys.add(key);
        }

        expect(translatedFiles).toEqual(expect.arrayContaining([
            '../../packages/core/src/shared/routes/History.jsx',
            '../../packages/core/src/shared/routes/ScanRoute.jsx',
            '../../packages/core/src/shared/routes/Send.jsx',
        ]));
        expect(usedKeys.size).toBeGreaterThan(0);
        expect(missingTranslationKeys(usedKeys, en)).toEqual([]);
    });
});
