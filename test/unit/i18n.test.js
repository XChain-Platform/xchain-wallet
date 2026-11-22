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
import { IntlMessageFormat } from 'intl-messageformat';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    formatOrList,
    getFormatLocale,
    getLocale,
    onLocaleChange,
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';

const traverse = _traverse.default || _traverse;
const TEST_LOCALE = 'unit-partial';
const TRANSLATION_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const TRANSLATION_LITERAL = /['"`][a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+['"`]/;
const URL_HOST = /^(?:[a-z0-9-]+\.)+(?:com|io|org)$/i;
const packageKeySources = import.meta.glob(
    [
        '../../packages/**/*.{js,jsx}',
        '!../../packages/core/src/i18n/locales/**',
        // Build output holds minified copies of the same source; parsing it
        // adds nothing and times the test out after a local build.
        '!../../packages/**/dist/**',
        '!../../packages/**/build/**',
        '!../../packages/mobile/www/**',
        '!../../packages/mobile/android/**',
        '!../../packages/mobile/ios/**',
        '!../../packages/**/node_modules/**',
    ],
    { query: '?raw', import: 'default', eager: true },
);
const SHARED_SOURCE_PREFIX = '../../packages/core/src/shared/';
const URI_SOURCE_PREFIX = '../../packages/core/src/uri/';
const packageSources = Object.fromEntries(Object.entries(packageKeySources).filter(([file]) => (
    file.startsWith(SHARED_SOURCE_PREFIX) || file.startsWith(URI_SOURCE_PREFIX)
)));
const sharedSourceFiles = new Set(Object.keys(packageKeySources).filter(
    (file) => file.startsWith(SHARED_SOURCE_PREFIX),
));

function translationUsage(source, acceptsInjectedTranslator = false) {
    // Most package files cannot contain a translation key or import t. Avoid
    // paying for a Babel parse until the raw source can contribute to either.
    if (!TRANSLATION_LITERAL.test(source) && !source.includes('/i18n/index.js')) {
        return { importsT: false, keys: new Set() };
    }
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    let importsT = false;
    const keys = new Set();

    // A scoped Babel traversal is needed by the placeholder audit below, but
    // this scan only visits imports and literals. Walking child nodes directly
    // avoids constructing bindings for every package file.
    const pending = [ast.program];
    while (pending.length > 0) {
        const node = pending.pop();
        if (node.type === 'ImportDeclaration' && node.source.value.endsWith('/i18n/index.js')) {
            importsT ||= node.specifiers.some((specifier) => (
                specifier.type === 'ImportSpecifier' && specifier.imported.name === 't'
            ));
        } else if (node.type === 'StringLiteral') {
            if (TRANSLATION_KEY.test(node.value) && !URL_HOST.test(node.value)) keys.add(node.value);
        } else if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
            const value = node.quasis[0]?.value.cooked;
            if (value && TRANSLATION_KEY.test(value) && !URL_HOST.test(value)) keys.add(value);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === 'string') pending.push(child);
                }
            } else if (value && typeof value.type === 'string') {
                pending.push(value);
            }
        }
    }

    return {
        importsT,
        keys: importsT || acceptsInjectedTranslator ? keys : new Set(),
    };
}

function missingTranslationKeys(keys, dictionary) {
    return [...keys].filter((key) => typeof dictionary[key] !== 'string').sort();
}

function messageVariables(message) {
    const names = new Set();
    const visit = (elements) => {
        for (const element of elements) {
            if (element.type >= 1 && element.type <= 6) names.add(element.value);
            for (const option of Object.values(element.options ?? {})) visit(option.value);
            if (element.children) visit(element.children);
        }
    };
    visit(new IntlMessageFormat(message, 'en').getAst());
    return names;
}

function objectExpressionFor(node, scope) {
    if (node?.type === 'ObjectExpression') return { node, scope };
    if (node?.type !== 'Identifier') return null;
    const binding = scope.getBinding(node.name);
    if (binding?.path.node.type !== 'VariableDeclarator') return null;
    return objectExpressionFor(binding.path.node.init, binding.path.scope);
}

function propertyName(node, computed) {
    if (!computed && node?.type === 'Identifier') return node.name;
    if (node?.type === 'StringLiteral') return node.value;
    return null;
}

function keysFromExpression(node, scope, seen = new Set()) {
    if (!node) return new Set();
    if (node.type === 'StringLiteral') {
        return new Set(typeof en[node.value] === 'string' ? [node.value] : []);
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        const value = node.quasis[0]?.value.cooked;
        return new Set(typeof en[value] === 'string' ? [value] : []);
    }
    if (node.type === 'ConditionalExpression') {
        return new Set([
            ...keysFromExpression(node.consequent, scope, seen),
            ...keysFromExpression(node.alternate, scope, seen),
        ]);
    }
    if (node.type === 'LogicalExpression') {
        return new Set([
            ...keysFromExpression(node.left, scope, seen),
            ...keysFromExpression(node.right, scope, seen),
        ]);
    }
    if (node.type === 'Identifier') {
        const binding = scope.getBinding(node.name);
        if (!binding || seen.has(binding)) return new Set();
        seen.add(binding);
        if (binding.path.node.type !== 'VariableDeclarator') return new Set();
        return keysFromExpression(binding.path.node.init, binding.path.scope, seen);
    }
    if (node.type !== 'MemberExpression') return new Set();
    const resolved = objectExpressionFor(node.object, scope);
    if (!resolved) return new Set();
    const selectedName = propertyName(node.property, node.computed);
    const values = [];
    for (const property of resolved.node.properties) {
        if (property.type !== 'ObjectProperty') continue;
        const name = propertyName(property.key, property.computed);
        if (selectedName !== null && name !== selectedName) continue;
        values.push(...keysFromExpression(property.value, resolved.scope, seen));
    }
    return new Set(values);
}

function namesFromObjectExpression(node, scope, seen = new Set()) {
    if (!node) return null;
    if (node.type === 'ObjectExpression') {
        const names = new Set();
        for (const property of node.properties) {
            if (property.type === 'SpreadElement') {
                const spreadNames = namesFromObjectExpression(property.argument, scope, seen);
                if (spreadNames === null) return null;
                for (const name of spreadNames) names.add(name);
                continue;
            }
            if (property.type !== 'ObjectProperty') return null;
            const name = propertyName(property.key, property.computed);
            if (name === null) return null;
            names.add(name);
        }
        return names;
    }
    if (node.type !== 'Identifier') return null;
    const binding = scope.getBinding(node.name);
    if (!binding || seen.has(binding) || binding.path.node.type !== 'VariableDeclarator') return null;
    seen.add(binding);
    const names = namesFromObjectExpression(binding.path.node.init, binding.path.scope, seen);
    if (names === null) return null;
    for (const reference of binding.referencePaths) {
        const member = reference.parentPath;
        if (!member?.isMemberExpression() || member.node.object !== reference.node) continue;
        if (!member.parentPath?.isAssignmentExpression() || member.parentPath.node.left !== member.node) continue;
        const name = propertyName(member.node.property, member.node.computed);
        if (name !== null) names.add(name);
    }
    return names;
}

function placeholderCallViolations(file, source) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const violations = [];
    let checkedCalls = 0;

    traverse(ast, {
        CallExpression(path) {
            if (path.node.callee.type !== 'Identifier' || path.node.callee.name !== 't') return;
            const keys = keysFromExpression(path.node.arguments[0], path.scope);
            for (const key of keys) {
                const required = messageVariables(en[key]);
                if (required.size === 0) continue;
                checkedCalls += 1;
                const supplied = namesFromObjectExpression(path.node.arguments[1], path.scope);
                const missing = supplied === null
                    ? [...required]
                    : [...required].filter((name) => !supplied.has(name));
                if (missing.length === 0) continue;
                const line = path.node.loc?.start.line ?? '?';
                violations.push(`${file}:${line} t('${key}') does not supply {${missing.join('}, {')}}`);
            }
        },
    });

    return { checkedCalls, violations };
}

function unbalancedBrace(message) {
    let depth = 0;
    for (let index = 0; index < message.length; index += 1) {
        if (message[index] === '{') depth += 1;
        if (message[index] !== '}') continue;
        depth -= 1;
        if (depth < 0) return index;
    }
    return depth === 0 ? null : message.length;
}

let packageTranslationUsage;

beforeAll(() => {
    packageTranslationUsage = new Map(Object.entries(packageKeySources).map(([file, source]) => (
        [file, translationUsage(source, true)]
    )));
});

beforeEach(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

afterAll(async () => {
    if (getLocale() !== 'en') await setLocale('en');
});

describe('formatOrList', () => {
    it('joins accepted word counts as an English "or" list and leaves one value bare', () => {
        expect(formatOrList([12, 15, 18, 21, 24])).toBe('12, 15, 18, 21, or 24');
        expect(formatOrList([12])).toBe('12');
    });

    it('reads the word-count error through the dictionary', () => {
        expect(t('importWallet.phrase.wrongWordCount', {
            expected: formatOrList([12, 15, 18, 21, 24]),
            count: 13,
        })).toBe('Expected 12, 15, 18, 21, or 24 words, got 13.');
    });

    it('formats under a locale code Intl rejects instead of throwing', async () => {
        // Same shape as pseudo-rtl: a 3-letter subtag after a long language.
        registerLocale('pseudo-rtl-list', en);
        await setLocale('pseudo-rtl-list');
        expect(formatOrList([12, 24])).toBe('12 or 24');
    });
});

describe('translations', () => {
    it('keeps English copy platform-neutral and typographically consistent', () => {
        const values = Object.values(en);

        expect(values.filter((value) => /\.\.\.| {2,}|\bclick\b/i.test(value))).toEqual([]);
        expect(values.filter((value) => (
            /\b(cannot|does not|do not|will not|could not|has not|is not|are not|it is)\b/i.test(value)
        ))).toEqual([]);
        const narrativeValues = Object.entries(en)
            .filter(([key]) => (
                (/(?:Body|Hint|Help)$|\.error\./.test(key))
                && key !== 'history.filters.fiatHelp'
            ))
            .map(([, value]) => value);
        expect(narrativeValues.filter((value) => !/[.!?…]$/.test(value))).toEqual([]);
        // Reviewed exception, not a way round the rule above: a `...Desc` key is
        // the one-line description under an action row's title (Batch's Add
        // and Remove rows, the co-signer detail menu), which matches the
        // literal action-row descriptions in shared routes ("Change its name
        // and tile") and so ends with no full stop. It must hold only that:
        // a Desc that grows into sentences belongs under Hint or Body.
        const rowDescriptions = Object.entries(en).filter(([key]) => /Desc$/.test(key));
        expect(rowDescriptions.filter(([, value]) => /[.!?…]$/.test(value) || /[.!?]\s/.test(value))).toEqual([]);
        expect(en['send.destination.placeholder']).toBe('Enter an address or name…');
    });

    it('keeps localized A-to-M route copy plain and consistent', () => {
        expect({
            networkSettings: en['common.openNetworkSettings'],
            unavailable: en['common.notAvailable'],
            watcher: en['common.watcherBuildsUnsigned'],
            multisigAvailability: en['multisig.share.availability'],
            signerRegion: en['home.signer.region'],
            signerBody: en['home.signer.body'],
            confirmFacts: en['confirmStandard.facts'],
            arguments: en['execute.params'],
            savedPackKey: en['gatedPublish.watcherSavedKey'],
            watcherPackKey: en['gatedPublish.watcherHint'],
            importOptions: en['importWallet.lane'],
            historySearch: en['history.filters.searchPlaceholder'],
        }).toEqual({
            networkSettings: 'Open Network Settings',
            unavailable: 'Not available',
            watcher: 'Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
            multisigAvailability: "Only addresses from a software wallet can be shared here. An address with no key in this wallet can't be shared, and a hardware wallet must export this information from the device or its companion app.",
            signerRegion: 'Signer for another phone home',
            signerBody: "This wallet signs transactions built on your other phone. Sending, receiving, and balances aren't available here. Its wallet mode is shown on Wallet Details.",
            confirmFacts: 'Action details',
            arguments: 'Arguments',
            savedPackKey: 'The pack key is saved in this wallet. Sign the transaction on the phone that signs for this wallet, then broadcast it from a wallet that can send it to the network.',
            watcherPackKey: 'Another phone signs for this wallet: this prepares the transaction for it. The pack key stays in this wallet either way.',
            importOptions: 'Wallet import options',
            historySearch: 'Search by action, address, token, transaction ID, or memo…',
        });
    });

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

    it('formats localized plurals with their source dictionary rules', async () => {
        registerLocale('ru', {
            'addressList.hidden.show': [
                '{count, plural, one {Show # hidden address-one} few {Show # hidden addresses-few}',
                'many {Show # hidden addresses-many} other {Show # hidden addresses-other}}',
            ].join(' '),
        });
        await setLocale('ru');

        expect(t('addressList.hidden.show', { count: 1 })).toBe('Show 1 hidden address-one');
        expect(t('addressList.hidden.show', { count: 2 })).toBe('Show 2 hidden addresses-few');
        expect(t('addressList.hidden.show', { count: 5 })).toBe('Show 5 hidden addresses-many');
        expect(t('history.recipients.saved', { count: 21, name: 'Ada' }))
            .toBe('Saved 21 addresses as a single contact "Ada".');
    });

    it('bounds cached locale resolutions', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const anchor = 'unit cache anchor';

        expect(getFormatLocale(anchor)).toBe('en');
        expect(getFormatLocale(anchor)).toBe('en');
        expect(warn).toHaveBeenCalledTimes(1);

        for (let i = 0; i <= 100; i += 1) {
            expect(getFormatLocale(`unit cache filler ${i}`)).toBe('en');
        }
        expect(getFormatLocale(anchor)).toBe('en');
        expect(warn).toHaveBeenCalledTimes(103);

        warn.mockRestore();
    });

    it('stamps root language metadata when the selected locale is already active', async () => {
        document.documentElement.removeAttribute('dir');
        document.documentElement.lang = 'stale';
        const subscriber = vi.fn();
        const unsubscribe = onLocaleChange(subscriber);

        await setLocale('en');

        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
        expect(subscriber).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('interpolates message variables', () => {
        expect(t('pending.detail.firstSeen', { when: 'just now' }))
            .toBe('First seen by the network just now');
    });

    it('reports a translation call that omits a required placeholder', () => {
        const source = `
            const t = () => {};
            t('send.networkFeeValue', { amount: '0.1' });
        `;

        expect(placeholderCallViolations('fixture.js', source).violations)
            .toEqual(["fixture.js:3 t('send.networkFeeValue') does not supply {ticker}"]);
    });

    it('supplies every English placeholder at every statically keyed t() call', () => {
        const violations = [];
        let checkedCalls = 0;

        for (const [file, source] of Object.entries(packageSources)) {
            if (!/\bt\s*\(/.test(source)) continue;
            const result = placeholderCallViolations(file, source);
            checkedCalls += result.checkedCalls;
            violations.push(...result.violations);
        }

        expect(checkedCalls).toBeGreaterThan(50);
        expect(violations).toEqual([]);
    });

    it('keeps braces balanced in every English string', () => {
        const violations = Object.entries(en)
            .map(([key, message]) => [key, unbalancedBrace(message)])
            .filter(([, index]) => index !== null)
            .map(([key, index]) => `${key} has an unbalanced brace at index ${index}`);

        expect(violations).toEqual([]);
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
        [0, 'Total: 5 XCP to 0 recipients, in one transaction with one network fee.', 'One transaction carries at most 0 recipients. Send to anyone else in another payment.', '0 of 0 history items shown', '0 Confirmations'],
        [1, 'Total: 5 XCP to 1 recipient, in one transaction with one network fee.', 'One transaction carries at most 1 recipient. Send to anyone else in another payment.', '1 of 1 history item shown', '1 Confirmation'],
        [3, 'Total: 5 XCP to 3 recipients, in one transaction with one network fee.', 'One transaction carries at most 3 recipients. Send to anyone else in another payment.', '3 of 3 history items shown', '3 Confirmations'],
    ])('pluralizes translated count copy for %i', (count, recipients, maximum, shown, confirmations) => {
        // Send's Multi tab total and its one-transaction limit.
        expect(t('send.multi.total', { total: '5 XCP', count })).toBe(recipients);
        expect(t('send.multi.limit', { count })).toBe(maximum);
        expect(t('history.itemsShown', { shown: count, total: count })).toBe(shown);
        expect(t('history.row.confirmations', { count })).toBe(confirmations);
    });

    it('pluralizes audited English address, token, and confirmation copy', () => {
        expect(t('addressList.hidden.show', { count: 1 })).toBe('Show 1 Hidden Address');
        expect(t('addressList.hidden.show', { count: 2 })).toBe('Show 2 Hidden Addresses');
        expect(t('balanceList.hiddenTokens.show', { count: 1 })).toBe('Show 1 hidden token');
        expect(t('balanceList.hiddenTokens.show', { count: 2 })).toBe('Show 2 hidden tokens');
        expect(t('transactionStatus.confirmations', { count: 1 })).toBe('1 confirmation');
        expect(t('transactionStatus.confirmations', { count: 2 })).toBe('2 confirmations');
    });

    it.each([
        [0, '0 protected content packs', 'packs'],
        [1, '1 protected content pack', 'pack'],
        [3, '3 protected content packs', 'packs'],
    ])('pluralizes gated pack counts for %i', (count, totalCopy, missingCopy) => {
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`includes ${totalCopy}`);
        expect(t('send.gated.partial', {
            total: count,
            available: 0,
            missingCount: count,
            missing: 'abc',
        })).toContain(`missing ${missingCopy}:`);
    });

    it('keeps duplicate English text only when translation context differs', () => {
        const keysByText = Object.entries(en).reduce((groups, [key, text]) => {
            const keys = groups.get(text) ?? [];
            keys.push(key);
            groups.set(text, keys);
            return groups;
        }, new Map());
        const duplicateKeyGroups = [...keysByText.values()]
            .filter((keys) => keys.length > 1)
            .map((keys) => keys.sort())
            .sort((a, b) => a[0].localeCompare(b[0]));

        expect(duplicateKeyGroups).toEqual([
            // The account picker's default account name and a found account's row name on the hardware connect flow.
            ['accountPicker.defaultName', 'hardwareConnect.accounts.accountName'],
            // The account picker title, the hardware connect Accounts tab and its third step name.
            ['accountPicker.title', 'hardwareConnect.accounts.accountsTab', 'hardwareConnect.step.accounts'],
            // The Action detail Verification field and About's Verification section title.
            ['actionDetail.field.verification', 'settings.about.sectionVerification'],
            // The Action detail status step a transaction has passed, the transaction timeline label for the same stage, and the BROADCAST wallet menu row.
            ['actionDetail.step.broadcast', 'txTimeline.broadcast.label', 'walletMenu.row.broadcast'],
            // The Action detail step and the transaction timeline label for a processed transaction.
            ['actionDetail.step.processed', 'txTimeline.processed.label'],
            // The Action detail step and the transaction timeline label for a signed transaction.
            ['actionDetail.step.signed', 'txTimeline.signed.label'],
            // A finished Action detail step and a finished transaction timeline stage.
            ['actionDetail.stepState.done', 'txTimeline.state.complete'],
            // The address detail's Actions heading reuses the menu group, token page heading and tab, and multisig start label.
            ['addressList.detail.actions', 'multisig.start.actionsLabel', 'routes.manageToken.actions', 'tokenDetail.tabs.actions', 'walletMenu.group.actions'],
            // The address detail's Balance row and Manage token's Balance row.
            ['addressList.detail.balance', 'routes.manageToken.balance'],
            // The address detail's card name, its unlabelled fallback, and the Address field on Address preferences, Verify signature and the unbind form.
            ['addressList.detail.card', 'addressList.detail.unlabelled', 'addressPreferences.address', 'unbindForm.targetAddress', 'verifySignature.address'],
            // Copy confirmation on the address detail and in History.
            ['addressList.detail.copied', 'history.copy.copied'],
            // Copying an address from the address detail and History.
            ['addressList.detail.copy', 'history.copy.walletAddress'],
            // Delete on the address detail and on a notification.
            ['addressList.detail.delete', 'settings.notifications.delete'],
            // The account path row on the address detail and on the multisig share page.
            ['addressList.detail.derivationPath', 'multisig.share.derivationPath'],
            // The Details heading on the address detail, the reachability line's link and the token page's Details tab.
            ['addressList.detail.details', 'components.reachabilityLine.details', 'tokenDetail.tabs.details'],
            // The address detail's Dispensers row and the wallet menu row.
            ['addressList.detail.dispensers', 'walletMenu.row.dispensers'],
            // The address detail's block explorer link and the Explorer donation recipient on the confirm line and Settings.
            ['addressList.detail.explorer', 'components.confirmSummary.donationRecipientExplorer'],
            // Hiding an address and hiding a developer value.
            ['addressList.detail.hide', 'settings.developer.hide'],
            // The address detail's Label section and the address list's Label field.
            ['addressList.detail.labelSection', 'routes.addressList.label'],
            // The loading state of the address detail and the common loading label.
            ['addressList.detail.loading', 'common.loading'],
            // The address detail's Multisig row and the wallet menu row.
            ['addressList.detail.multisig', 'walletMenu.row.multisig'],
            // Network names the address detail row, side-menu group, Send field and Settings row.
            ['addressList.detail.network', 'components.leftNav.groupNetwork', 'send.fields.chain', 'settings.network.label'],
            // The protocol fee row on the address detail and on Execute contract.
            ['addressList.detail.protocolFee', 'execute.protocolFee'],
            // The Receive action on the address detail, Home and the token page, its menu row and its intent title.
            ['addressList.detail.receive', 'home.receive', 'tokenDetail.actions.receive', 'uri.intent.receive', 'walletMenu.row.receive'],
            // The type row on the address detail, Home's Balances Type filter field, the Publish File review and the wallet details.
            ['addressList.detail.type', 'home.filter.type', 'publishFile.details.type', 'walletDetails.type'],
            // Unhiding an address and the display settings' unhide action.
            ['addressList.detail.unhide', 'settings.display.unhide2'],
            // A closed section's empty summary (Address preferences, Issue) and the shortcut help's unset binding state.
            ['addressPreferences.notSet', 'issue.summary.notSet', 'keyboard.shortcutHelp.notSet'],
            // The Continue button on the donations notice and on the hardware connect step.
            ['adsNotice.continue', 'hardwareConnect.connect.continue'],
            // The feature's one name: the onboarding notice title, the command palette entry and the Settings page title.
            ['adsNotice.title', 'palette.settings.ads', 'settings.page.automaticDonations'],
            // The Airdrop form's token picker and section title reuse the wording of the Roster picker and the palette command.
            ['airdrop.picker.addToken', 'projectRoster.pickerTitle'],
            // The wallet menu's Assets row carries the same name.
            ['airdrop.section.airdrop', 'palette.createAirdrop.title', 'walletMenu.row.airdrop'],
            // The alerts page title, its notifications heading, the header bell label and the wallet menu row.
            ['alerts.notificationsTitle', 'alerts.title', 'shell.header.notifications', 'walletMenu.row.alerts'],
            // An action count: a Batch transaction's summary and a co-signer account's window.
            ['batch.actionCount', 'coSigner.detail.windowCount'],
            // The network fee line on Batch and on Send.
            ['batch.networkFeeFor', 'send.networkFeeValue'],
            // The command title, Settings row and wallet menu row for the action queue.
            ['commandPalette.actionQueue.title', 'settings.developer.actionQueue', 'walletMenu.row.actionQueue'],
            // A shared reachability retry label and the settings backup checker.
            ['common.checking', 'settings.backup.checking'],
            // The shared Done button and Multisig Sessions' Done tab (finished sessions).
            ['common.done', 'multisig.sessions.tabDone'],
            // The confirm summary's Batch verb and the wallet menu row that opens Batch.
            ['components.confirmSummary.verbBatch', 'walletMenu.row.batch'],
            // The confirm summary verb and wallet menu row name the same action.
            ['components.confirmSummary.verbCreatePoll', 'walletMenu.row.createPoll'],
            // The prediction purchase and order purchase buttons share the short action label.
            ['components.confirmSummary.verbPlaceBet', 'components.placeOrderPanel.buy'],
            // The confirm summary's verb names the same action as the Trade page's one button.
            ['components.confirmSummary.verbPlaceOrder', 'market.trade.placeOrder'],
            // The confirm summary's verb names the token page's Sell Ownership action (operator 2026-11-15 rename).
            ['components.confirmSummary.verbSellOwnership', 'routes.manageToken.sellName'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['components.contactsPickerScreen.contacts', 'walletMenu.row.contacts'],
            // Draft notices and the Send draft use the same restore action.
            ['components.draftNotice.restore', 'send.draft.restore'],
            // The trade forms' shared Expiration field and the Place order panel's.
            ['components.expiration.label', 'components.placeOrderPanel.expiration'],
            // The side menu, command palette and wallet menu share the prediction markets label.
            ['components.leftNav.bettingMarkets', 'palette.navBetting.title', 'walletMenu.row.betting'],
            // The side-menu destination and full-menu group use the same short governance label.
            ['components.leftNav.governance', 'walletMenu.group.governance'],
            // The side menu, command palette and menu model share the Trade group label.
            ['components.leftNav.groupTrade', 'palette.category.trade', 'walletMenu.group.trade'],
            // The side menu, backup fallback, Settings and menu model share the Wallet group label.
            ['components.leftNav.groupWallet', 'settings.backup.walletFallback', 'settings.thisWallet.wallet', 'walletMenu.group.wallet'],
            // The order book's size column and its size field label, and the Publish File review's size row.
            ['components.orderbookPanel.size', 'components.orderbookPanel.sizeLabel', 'publishFile.details.size'],
            // The order panel's Market label and the token page's Market section.
            ['components.placeOrderPanel.market', 'tokenMarket.label'],
            // The order panel's price field and the token page's price row.
            ['components.placeOrderPanel.price', 'tokenMarket.price'],
            // The Trade page's Swap mode in its Swap | Limit | Market toggle and the command palette's Swap entry.
            ['components.placeOrderPanel.swap', 'palette.tradeSwap.title'],
            // The signing screen's title and the wallet menu row that opens Sign transaction.
            ['components.psbtConfirmScreen.signTransaction', 'walletMenu.row.signTransaction'],
            // Re-sending an interrupted queued send, retrying a desktop update
            // download and retrying a balance load.
            ['components.queuedBroadcastBanner.trySendingAgain', 'desktopUpdate.retry', 'home.retryBalances'],
            // (The queued banner's Send Now is a Title Case button now, so it no
            // longer shares the multisig pill's "Send now" text.)
            // The token list editor's field label and the Home Tokens tab.
            ['components.tickItemsEditor.tokens', 'home.tabs.tokens'],
            // The token field's empty state and the unbind form's token placeholder.
            ['components.tokenField.selectAToken', 'unbindForm.selectToken'],
            // The header badge and the wallet mode it names: Signs on another phone (§20).
            ['components.watchOnlyBadge.watchOnly', 'walletDetails.walletMode.watcher'],
            // The Compose message byte counter's encrypted and plain forms read the same.
            ['composeMessage.byteCountEncrypted', 'composeMessage.byteCountPlain'],
            // The address-load failure on Compose message and on the unbind form.
            ['composeMessage.loadFailed', 'unbindForm.loadFailed'],
            // The Compose message page title and the wallet menu's People row.
            ['composeMessage.newTitle', 'walletMenu.row.newMessage'],
            // The noun the queued-result panel names for a held message and the noun the signing warning names.
            ['composeMessage.whatMessage', 'extension.sign.warningNoun.message'],
            // The confirm page's change-back fact row and a governance proposal's Change field.
            ['confirmStandard.change', 'governance.detail.change'],
            // The confirmation fact and Issue section share the Locks label.
            ['confirmStandard.fact.locks', 'issue.section.locks'],
            // The confirmation headline and status share the unknown-action label.
            ['confirmStandard.sentence.unknownAction', 'confirmStandard.status.unknownAction'],
            // The empty-activity title on a co-signer's detail page and on History.
            ['coSigner.detail.activityEmptyTitle', 'history.empty.noActivityTitle'],
            // Turning an agent account on (an action row) and a Settings switch's on label.
            ['coSigner.detail.turnOn', 'settings.toggle.turnOn'],
            // A token count on an agent account and the Project Tokens section's closed summary.
            ['coSigner.tokenCount', 'projectRoster.tokenCount'],
            // The Extra Passphrase section's closed summary reads Off or On, as the Settings switch states do;
            // Off is also the localhost password timeout's off choice (its help says Off asks every time),
            // the form-draft dropdown's off choice and the Settings row status for a feature that is off.
            ['createWallet.extraPassphraseOff', 'settings.developer.offAlwaysPrompt', 'settings.privacy.off'],
            ['createWallet.extraPassphraseOn', 'settings.page.on'],
            // Every action form's From field: Execute contract, Send and Unbind controller.
            ['execute.caller', 'send.fields.from', 'unbindForm.from'],
            // Loading addresses on Execute contract and on the unbind form.
            ['execute.loadingAddresses', 'unbindForm.loadingAddresses'],
            // The Token field on Execute contract's Deposit section, on Send and on the unbind form.
            ['execute.tokenLabel', 'send.fields.token', 'unbindForm.token'],
            // Connect field help uses the shared field help label.
            ['extension.connect.aboutField', 'ui.field.about'],
            // The dApp connect page's network list and the hardware connect Networks tab and list.
            ['extension.connect.chains', 'hardwareConnect.accounts.networksLabel', 'hardwareConnect.accounts.networksTab'],
            // Both shell recovery paths use the same concise reload action.
            ['extension.connection.reload', 'home.sdkLoadFailure.reload'],
            // The empty token list on Gated publish and on the unbind form.
            ['gatedPublish.tokens.noneTitle', 'unbindForm.noTokensTitle'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['governance.myDelegations', 'walletMenu.row.myDelegations'],
            // Poll and History filters share the same all-status label.
            ['governance.statusFilter.all', 'history.filters.allStatuses'],
            // Closed is the same status on a poll and a swap.
            ['governance.statusFilter.closed', 'mySwaps.status.closed'],
            // The filter heading and action-status prefix use the same noun.
            ['governance.statusFilter.label', 'history.filters.statusHeader', 'parallelComposer.statusPrefix'],
            // Open is the status label and the developer folder action.
            ['governance.statusFilter.open', 'settings.developer.open'],
            // A governance proposal that has not opened and a transaction timeline stage not reached yet.
            ['governance.statusFilter.pending', 'txTimeline.state.notStarted'],
            // The Add Wallet button on the hardware connect flow and on the wallet picker.
            ['hardwareConnect.accounts.addWallet', 'walletPicker.add'],
            // A found account's balance line and the faucet's amount line: the amount and its ticker.
            ['hardwareConnect.accounts.amount', 'settings.testNetworks.faucet.amountLine'],
            // The Wallet name field on the hardware connect flow and on Rename wallet.
            ['hardwareConnect.accounts.name', 'renameWallet.name'],
            // The Help with connecting row on the connect step and the help page's form label.
            ['hardwareConnect.connect.help', 'hardwareConnect.help.formLabel'],
            // The Try again row on the connect step and the vault-unavailable retry row.
            ['hardwareConnect.connect.tryAgain', 'vaultUnavailable.actions.retry.title'],
            // The Unlock step on the hardware connect status line, Import's unlock action and the demo unlock button.
            ['hardwareConnect.connect.unlock', 'importWallet.unlockExisting', 'onboarding.demo.unlock'],
            // The Open in tab button on the hardware connect flow and on Import wallet.
            ['hardwareConnect.openInTab', 'importWallet.openInTab'],
            // The vendor brand names on the hardware connect flow and on Send's device line.
            ['hardwareConnect.vendor.ledger', 'send.device.ledger'],
            ['hardwareConnect.vendor.trezor', 'send.device.trezor'],
            // Saving a custom notification sound and a contact share the action label.
            ['history.contact.save', 'settings.notifications.saveSound'],
            // Loading the History page and the token page's History tab.
            ['history.loading', 'tokenDetail.history.loading'],
            // The History status chip and the timeline stage heading for a confirmed transaction.
            ['history.status.confirmed', 'txTimeline.confirmed.label'],
            // The History status chip and the timeline label for a transaction that failed.
            ['history.status.failed', 'txTimeline.mempool.failedLabel'],
            // The History page, its menu row and the token page's History tab.
            ['history.title', 'tokenDetail.tabs.history', 'walletMenu.row.history'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['home.addresses', 'walletMenu.row.addresses'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['home.lockWallet', 'walletMenu.row.lock'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['home.settings', 'walletMenu.row.settings'],
            // The two-phone signer mode's one name: Home's signer card title and the Wallet Details mode row.
            ['home.signer.title', 'walletDetails.walletMode.signer'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['home.title', 'walletMenu.row.home'],
            // Wide Home's Allocation table header over the ticker column, and the Send form's Asset field.
            ['home.wide.allocation.asset', 'send.asset'],
            // The Allocation table's Share column header (a portion of the wallet), and the multisig signing link's Share action (a verb).
            ['home.wide.allocation.share', 'multisig.share.button', 'multisig.signingLink.share'],
            // The password that opens a backup file, on the restore tab and where Settings saves one.
            ['importWallet.backup.password', 'settings.backup.backupPassword'],
            // Import and locked recovery use the same backup page title.
            ['importWallet.backup.title', 'locked.forgot.backup.pageTitle'],
            // A backup's name when its file header names no wallet, and the backup file type in Settings.
            ['importWallet.backup.unnamed', 'settings.backup.walletBackupFileType'],
            // The wallet's own password: the restore tab's second field and a gated send's password field.
            ['importWallet.backup.walletPassword', 'send.gated.passwordLabel'],
            // The import screen's short Backup lane tab (G42) and the Settings Backup page.
            ['importWallet.tab.backup', 'settings.page.backup'],
            // Import and Receive share the address-type field label.
            ['importWallet.wif.addressType', 'receive.addressType'],
            // The Issue form's supply cap field and Manage token's supply cap lock.
            ['issue.maxSupply', 'routes.manageToken.lockMaxSupply'],
            // The Issue form's Callback section header and Manage token's callback lock.
            ['issue.section.callback', 'routes.manageToken.lockCallback'],
            // The Issue form's Description section header and Manage token's description action and detail row.
            ['issue.section.description', 'routes.manageToken.description'],
            // The issue list summary and the duress settings action.
            ['issue.summary.set', 'settings.duress.set'],
            // Locked recovery uses the same phrase title for its page and action.
            ['locked.forgot.phrase.pageTitle', 'locked.forgot.phrase.submit'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['market.myOrders', 'walletMenu.row.myOrders'],
            // The 24-hour high on the market page and on the token page.
            ['market.stats.high24h', 'tokenMarket.high24h'],
            // The 24-hour low on the market page and on the token page.
            ['market.stats.low24h', 'tokenMarket.low24h'],
            // The Multisig Sessions list's name, and the palette command and wallet menu row that open it.
            ['multisig.sessions.listLabel', 'palette.navMultisigSign.title', 'walletMenu.row.multisigSigning'],
            // A ready-to-finalize session's pill and the Ready tab (sessions that need you).
            ['multisig.sessions.pillReady', 'multisig.sessions.tabReady'],
            // The Send page, its menu row and intent title, the token page's Send action and the multisig start action.
            ['multisig.start.actionSend', 'send.title', 'tokenDetail.actions.send', 'uri.intent.send', 'walletMenu.row.send'],
            // The raw action tool in the palette, Settings and the wallet menu.
            ['palette.createAdvanced.title', 'settings.developer.advancedAction', 'walletMenu.row.advancedAction'],
            // The wallet menu rows reuse the palette command they replace in search.
            ['palette.createDispenser.title', 'walletMenu.row.createDispenser'],
            // The wallet menu row, the palette entry it replaces in search and the Publish File form's label.
            ['palette.createPublishFile.title', 'publishFile.formLabel', 'walletMenu.row.publishFile'],
            ['palette.createToken.title', 'walletMenu.row.createToken'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['palette.navBrowseDispensers.title', 'walletMenu.row.browseDispensers'],
            ['palette.navMySwaps.title', 'walletMenu.row.mySwaps'],
            ['palette.tradeCoinpay.title', 'walletMenu.row.payOrder'],
            ['palette.tradeOrder.title', 'walletMenu.row.createOrder'],
            ['palette.tradeXchainOrder.title', 'walletMenu.row.crossChainOrder'],
            ['palette.tradeXchainSwap.title', 'walletMenu.row.crossChainSwap'],
            // The pending detail headline for a transaction replaced elsewhere and the timeline label for one the user replaced.
            ['pending.detail.replacedElsewhere', 'txTimeline.mempool.replacedLabel'],
            // The command palette's About entry and the About page's title name the same destination.
            ['routes.addressList.about', 'settings.about.pageTitle'],
            // An address list row's Hidden state and the Hide Small Balances preview's tag on a folded balance.
            ['routes.addressList.hidden', 'settings.smallBalances.tagHidden'],
            // Manage token's controller row and the unbind form's Controller section.
            ['routes.manageToken.controller', 'unbindForm.section'],
            // Manage token's dispenser action and the token page's dispenser row.
            ['routes.manageToken.dispenser', 'tokenMarket.dispenser'],
            // Manage token's Unbind controller action and the form it opens.
            ['routes.manageToken.unbindController', 'unbindForm.label'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['scan.title', 'walletMenu.row.scan'],
            // An empty value on Send's advanced options and in the unbind form's summary.
            ['send.advanced.none', 'unbindForm.none'],
            // The From address picker title on Send and on the unbind form.
            ['send.fromAddress', 'unbindForm.fromPickerTitle'],
            // The Memo field on Send and on the unbind form.
            ['send.memo', 'unbindForm.memo'],
            // Multi-send updates a recipient while About updates the application.
            ['send.multi.save', 'settings.about.updateAction'],
            // The source-address picker button on Send and on the unbind form.
            ['send.source.choose', 'unbindForm.choosePicker'],
            // The transaction ID row on Send's result and on the unbind form's result.
            ['send.txid', 'unbindForm.transactionId'],
            // The wallet menu reuses the label the same destination carries elsewhere.
            ['settings.connectedSites.connectedSites', 'walletMenu.row.connectedSites'],
            // The backup help names the Wallet Details action it describes.
            ['settings.help.backup.exportBackup', 'walletDetails.exportBackupAction'],
            // The governance notification switch and the wallet menu row name the same polls.
            ['settings.notifications.governancePolls', 'walletMenu.row.governancePolls'],
            // A custom sound and wallet detail share the Name field label.
            ['settings.notifications.soundName', 'walletDetails.name'],
            // The Settings Wallets page and the wallet menu's Wallets group.
            ['settings.page.walletsList', 'walletMenu.group.wallets'],
            // The Hide Small Balances page's Options tab and the icon dropdown's list of options.
            ['settings.smallBalances.tabOptions', 'ui.iconSelect.options'],
            // The This wallet remove button and the Wallet Details remove page title name the same action.
            ['settings.thisWallet.removeWalletAction', 'walletDetails.remove.title'],
            // The Normal fee level and the Normal wallet mode (§20).
            ['ui.feeSelector.normal', 'walletDetails.walletMode.full'],
        ]);
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

    it('keeps English keys synchronized with package source', () => {
        const translatedFiles = [];
        const usedKeys = new Set();

        for (const [file, usage] of packageTranslationUsage) {
            if (!sharedSourceFiles.has(file)) continue;
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

        const referencedKeys = new Set(usedKeys);
        for (const usage of packageTranslationUsage.values()) {
            for (const key of usage.keys) referencedKeys.add(key);
        }

        expect(Object.keys(en).filter((key) => !referencedKeys.has(key))).toEqual([]);
    });
});
