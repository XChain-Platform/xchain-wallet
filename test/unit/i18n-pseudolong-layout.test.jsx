// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { Settings } from '../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import {
    getLocale,
    registerLocale,
    setLocale,
    t,
} from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';
import {
    PSEUDO_LONG_LOCALE,
    PSEUDO_LONG_MARKER,
    pseudoLongDictionary,
    pseudoLongRenderedEnglish,
} from '../fixtures/pseudoLongLocale.js';

const readCss = (path) => readFileSync(path, 'utf8');
const buttonCss = readCss('packages/core/src/ui/Button.module.css');
const pageHeaderCss = readCss('packages/core/src/ui/PageHeader.module.css');
const homeCss = readCss('packages/core/src/shared/routes/Home.module.css');
const sendCss = readCss('packages/core/src/shared/routes/Send.module.css');
const receiveCss = readCss('packages/core/src/shared/routes/Receive.module.css');
const settingsCss = readCss('packages/core/src/shared/routes/Settings.module.css');
const VIEWPORT_WIDTH = 320;

const FIXED_INLINE_SIZE = /(?:^|;)\s*(?:width|min-width)\s*:\s*[0-9.]+(?:px|r?em)(?:\s*!important)?\s*(?:;|$)/i;
const CLIPPED_BUTTON_TEXT = /(?:^|;)\s*(?:white-space\s*:\s*nowrap|overflow\s*:\s*hidden|text-overflow\s*:\s*ellipsis)(?:\s*!important)?\s*(?:;|$)/i;

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

const SHARED_TEXT_RULES = [
    [buttonCss, '.btn'],
    [buttonCss, '.label'],
    [pageHeaderCss, '.title'],
];

const SCREEN_TEXT_RULES = {
    Home: [
        [homeCss, '.quickAction'],
        [homeCss, '.quickAction > span:last-child'],
        [homeCss, '.quickActionMoreItem'],
        [homeCss, '.quickActionsReason'],
        [homeCss, '.pendingAirdropTitle'],
        [homeCss, '.pendingAirdropHint'],
    ],
    Send: [
        [sendCss, '.hint'],
        [sendCss, '.summary'],
        [sendCss, '.detailsToggle'],
        [sendCss, '.detailsLabel'],
        [sendCss, '.detailsValue'],
        [sendCss, '.testSendTitle'],
        [sendCss, '.testSendBody'],
        [sendCss, '.recipientRowLabel'],
        [sendCss, '.successTitle'],
        [sendCss, '.successHint'],
    ],
    Receive: [
        [receiveCss, '.assetText'],
        [receiveCss, '.assetName'],
        [receiveCss, '.assetSub'],
        [receiveCss, '.hint'],
    ],
    Settings: [
        [settingsCss, '.page'],
        [settingsCss, '.sectionHeader'],
    ],
};

const BUTTON_TEXT_RULES = [
    [buttonCss, '.btn'],
    [buttonCss, '.label'],
    [homeCss, '.quickAction'],
    [homeCss, '.quickActionMoreItem'],
    [sendCss, '.detailsToggle'],
];

function auditClassRules(screenName) {
    for (const [css, selector] of [...SHARED_TEXT_RULES, ...SCREEN_TEXT_RULES[screenName]]) {
        const declarations = rule(css, selector);
        expect(declarations, `${screenName} is missing its ${selector} layout guard`).not.toBe('');
        expect(declarations, `${screenName} ${selector} fixes the width of text`)
            .not.toMatch(FIXED_INLINE_SIZE);
    }
    for (const [css, selector] of BUTTON_TEXT_RULES) {
        const declarations = rule(css, selector);
        expect(declarations, `${selector} is missing its button layout guard`).not.toBe('');
        expect(declarations, `${selector} clips button text`).not.toMatch(CLIPPED_BUTTON_TEXT);
    }
}

function expectNoFixedWidthTextClipping(container, screenName) {
    const offenders = [];
    const hasFixedSize = (value) => /^\d+(?:\.\d+)?(?:px|r?em)$/.test(value || '');
    const candidates = new Set(Array.from(container.querySelectorAll('[style]')).filter(
        (element) => hasFixedSize(element.style.width) || hasFixedSize(element.style.minWidth),
    ));
    const collectFixedRules = (rules) => {
        for (const cssRule of rules || []) {
            if (cssRule.cssRules) collectFixedRules(cssRule.cssRules);
            if (!cssRule.selectorText || !cssRule.style) continue;
            if (!hasFixedSize(cssRule.style.width) && !hasFixedSize(cssRule.style.minWidth)) continue;
            try {
                for (const element of container.querySelectorAll(cssRule.selectorText)) {
                    candidates.add(element);
                }
            } catch {
                // Unsupported selectors cannot match in this jsdom version.
            }
        }
    };
    for (const stylesheet of document.styleSheets) collectFixedRules(stylesheet.cssRules);

    for (const element of candidates) {
        if (!element.textContent.trim()) continue;
        const style = getComputedStyle(element);
        const fixed = hasFixedSize(style.width) || hasFixedSize(style.minWidth);
        const clips = style.textOverflow === 'ellipsis'
            || style.whiteSpace === 'nowrap'
            || style.overflowX === 'hidden'
            || style.overflow === 'hidden';
        if (fixed && clips) {
            offenders.push(`${element.tagName.toLowerCase()}.${element.className || '(no class)'}`);
        }
    }
    expect(offenders, `${screenName} has fixed-width text clipping`).toEqual([]);
}

const pending = new Promise(() => {});
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsendersendersendersendersendersendersa',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const BALANCES = {
    'bitcoin-mainnet': [{
        address: ADDRESS.address,
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }],
};
const defaultSettings = createDefaultSettings();

const messaging = new Proxy({
    getSettings: vi.fn().mockResolvedValue({
        ...defaultSettings,
        activeNetwork: 'mainnet',
        language: PSEUDO_LONG_LOCALE,
        walletMode: 'full',
        fees: { 'bitcoin-mainnet': { strategy: 'normal' } },
        privacy: { ...defaultSettings.privacy, formDraftTtlMs: 0 },
    }),
    listWallets: vi.fn().mockResolvedValue([{ id: 'wallet', name: 'Primary wallet' }]),
    listAccounts: vi.fn().mockResolvedValue([{
        id: 'account',
        walletId: 'wallet',
        name: 'Everyday spending',
        index: 0,
    }]),
    getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
    getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [ADDRESS] }),
    getActiveAddresses: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': ADDRESS }),
    getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
    getAddressBalances: vi.fn().mockResolvedValue({
        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
        tokens: [],
    }),
    getAddressHistory: vi.fn().mockResolvedValue([]),
    listContacts: vi.fn().mockResolvedValue([]),
    listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
}, {
    get(target, property) {
        if (property in target) return target[property];
        return typeof property === 'string' ? vi.fn(() => pending) : undefined;
    },
});

function withProviders(node) {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
            <ToastHost>{node}</ToastHost>
        </MessagingProvider>
    );
}

const SCREENS = [
    ['Home', () => (
        <Home
            activeWalletId="wallet"
            activeAccountId="account"
            onSend={() => {}}
            onReceive={() => {}}
            onExchange={() => {}}
            onActions={() => {}}
        />
    ), 4],
    ['Send', () => <Send walletId="wallet" accountId="account" onBack={() => {}} />, 4],
    ['Receive', () => <Receive walletId="wallet" accountId="account" onBack={() => {}} />, 4],
    ['Settings', () => (
        <Settings
            onBack={() => {}}
            activeWallet={{ id: 'wallet', name: 'Primary wallet' }}
            activeAccount={{ id: 'account', name: 'Everyday spending', index: 0 }}
            onOpenWalletPicker={() => {}}
            onOpenAccountPicker={() => {}}
        />
    ), 5],
];

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');

beforeAll(async () => {
    registerLocale(PSEUDO_LONG_LOCALE, pseudoLongDictionary);
    await setLocale(PSEUDO_LONG_LOCALE);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: VIEWPORT_WIDTH });
    window.dispatchEvent(new Event('resize'));
});

afterAll(async () => {
    await setLocale('en');
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
    if (originalClientWidth) {
        Object.defineProperty(document.documentElement, 'clientWidth', originalClientWidth);
    } else {
        delete document.documentElement.clientWidth;
    }
});

afterEach(() => cleanup());

describe('pseudo-long narrow layouts', () => {
    it('lengthens every English dictionary entry by about forty percent', () => {
        expect(Object.keys(pseudoLongDictionary)).toEqual(Object.keys(en));
        for (const [key, source] of Object.entries(en)) {
            const expectedLength = Math.ceil(Array.from(source).length * 1.4);
            expect(Array.from(pseudoLongDictionary[key]), key).toHaveLength(expectedLength);
        }
        expect(t('send.title')).toBe(pseudoLongDictionary['send.title']);
    });

    it('rejects a fixed-width control that clips its label', () => {
        const { container } = render(
            <button
                type="button"
                style={{ width: '80px', overflow: 'hidden', whiteSpace: 'nowrap' }}
            >
                A deliberately clipped pseudo-long action
            </button>,
        );

        expect(() => expectNoFixedWidthTextClipping(container, 'Falsification control'))
            .toThrow(/fixed-width text clipping/);
    });

    it.each(SCREENS)('renders %s at 320px without fixed-width text clipping', async (name, screenFactory, minimumButtons = 1) => {
        expect(getLocale()).toBe(PSEUDO_LONG_LOCALE);
        expect(window.innerWidth).toBe(VIEWPORT_WIDTH);
        const { container } = render(withProviders(screenFactory()));
        expect(container.firstElementChild).not.toBeNull();
        await waitFor(() => {
            expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(minimumButtons);
        });
        pseudoLongRenderedEnglish(container);
        const englishText = Array.from(container.querySelectorAll('*'))
            .flatMap((element) => Array.from(element.childNodes))
            .filter((node) => node.nodeType === Node.TEXT_NODE && /[A-Za-z]/.test(node.textContent))
            .map((node) => node.textContent.trim());
        expect(englishText.length).toBeGreaterThan(0);
        expect(englishText.every((text) => text.startsWith(PSEUDO_LONG_MARKER))).toBe(true);
        expectNoFixedWidthTextClipping(container, name);
        auditClassRules(name);
    });
});
