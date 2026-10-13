// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { History } from '../../packages/core/src/shared/routes/History.jsx';
import { Settings } from '../../packages/core/src/shared/routes/Settings.jsx';
import { Onboarding } from '../../packages/core/src/shared/routes/Onboarding.jsx';
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
const historyCss = readCss('packages/core/src/shared/routes/History.module.css');
const settingsCss = readCss('packages/core/src/shared/routes/Settings.module.css');
const onboardingCss = readCss('packages/core/src/shared/routes/Onboarding.module.css');

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
    History: [
        [historyCss, '.filterDisclosure'],
        [historyCss, '.segBtn'],
        [historyCss, '.chip'],
        [historyCss, '.detailAction'],
        [historyCss, '.moreMenuItem'],
        [historyCss, '.detailTab'],
    ],
    Settings: [
        [settingsCss, '.page'],
        [settingsCss, '.sectionHeader'],
    ],
    Onboarding: [
        [onboardingCss, '.namePopup'],
        [onboardingCss, '.nameFull'],
        [onboardingCss, '.taglinePopup'],
        [onboardingCss, '.taglineFull'],
        [onboardingCss, '.demoGraduateNotice'],
        [onboardingCss, '.licenseAck'],
    ],
};

const BUTTON_TEXT_RULES = [
    [buttonCss, '.btn'],
    [buttonCss, '.label'],
    [homeCss, '.quickAction'],
    [homeCss, '.quickActionMoreItem'],
    [sendCss, '.detailsToggle'],
    [historyCss, '.filterDisclosure'],
    [historyCss, '.segBtn'],
    [historyCss, '.chip'],
    [historyCss, '.detailAction'],
    [historyCss, '.moreMenuItem'],
    [historyCss, '.detailTab'],
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

const pending = new Promise(() => {});
const pendingMessaging = new Proxy({}, {
    get(_target, property) {
        return typeof property === 'string' ? vi.fn(() => pending) : undefined;
    },
});

function withProviders(node) {
    return (
        <MessagingProvider shell="popup" messaging={pendingMessaging}>
            <ToastHost>{node}</ToastHost>
        </MessagingProvider>
    );
}

const SCREENS = [
    ['Home', () => <Home activeWalletId="wallet" activeAccountId="account" />],
    ['Send', () => <Send walletId="wallet" accountId="account" onBack={() => {}} />],
    ['Receive', () => <Receive walletId="wallet" accountId="account" onBack={() => {}} />],
    ['History', () => <History walletId="wallet" accountId="account" onBack={() => {}} />],
    ['Settings', () => <Settings onBack={() => {}} />],
    ['Onboarding', () => <Onboarding onCreate={() => {}} onImport={() => {}} />],
];

beforeAll(async () => {
    registerLocale(PSEUDO_LONG_LOCALE, pseudoLongDictionary);
    await setLocale(PSEUDO_LONG_LOCALE);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 360 });
    window.dispatchEvent(new Event('resize'));
});

afterAll(async () => {
    await setLocale('en');
});

describe('pseudo-long narrow layouts', () => {
    it('lengthens every English dictionary entry by about forty percent', () => {
        expect(Object.keys(pseudoLongDictionary)).toEqual(Object.keys(en));
        for (const [key, source] of Object.entries(en)) {
            const expectedLength = Math.ceil(Array.from(source).length * 1.4);
            expect(Array.from(pseudoLongDictionary[key]), key).toHaveLength(expectedLength);
        }
        expect(t('send.title')).toBe(pseudoLongDictionary['send.title']);
    });

    it.each(SCREENS)('renders %s at 360px without text clipping rules', (name, screenFactory) => {
        expect(getLocale()).toBe(PSEUDO_LONG_LOCALE);
        expect(window.innerWidth).toBe(360);
        const { container } = render(withProviders(screenFactory()));
        expect(container.firstElementChild).not.toBeNull();
        pseudoLongRenderedEnglish(container);
        const englishText = Array.from(container.querySelectorAll('*'))
            .flatMap((element) => Array.from(element.childNodes))
            .filter((node) => node.nodeType === Node.TEXT_NODE && /[A-Za-z]/.test(node.textContent))
            .map((node) => node.textContent.trim());
        expect(englishText.length).toBeGreaterThan(0);
        expect(englishText.every((text) => text.startsWith(PSEUDO_LONG_MARKER))).toBe(true);
        auditClassRules(name);
    });
});
