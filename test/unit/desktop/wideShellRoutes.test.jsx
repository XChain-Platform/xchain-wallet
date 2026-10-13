// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    FullLayoutWithNav,
    LeftNav,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import layoutStyles from '../../../packages/core/src/shared/components/LeftNav.module.css';
import listStyles from '../../../packages/core/src/ui/ListPage.module.css';
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';

const readRepoFile = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
const layoutCss = readRepoFile('packages/core/src/shared/components/LeftNav.module.css');
const listCss = readRepoFile('packages/core/src/ui/ListPage.module.css');
const formCss = readRepoFile('packages/core/src/ui/FormPage.module.css');

const DESKTOP_WIDTHS = [1440, 1920];

function ruleBodies(styleText, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...styleText.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
        .map((match) => match[1]);
}

function lengthInPixels(declarations, pattern) {
    const match = declarations.map((declaration) => pattern.exec(declaration)).find(Boolean);
    if (!match) throw new Error(`${pattern} does not match a fixed CSS length`);
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

const ROUTES = [
    {
        name: 'Home',
        source: readRepoFile('packages/core/src/shared/routes/Home.jsx'),
        template: 'ListPage',
        contentClass: listStyles.page,
        contentCss: listCss,
        contentSelector: '.page',
        maxWidth: 48 * 16,
        render: () => <ListPage><article>Home card</article></ListPage>,
    },
    {
        name: 'History',
        source: readRepoFile('packages/core/src/shared/routes/History.jsx'),
        template: 'ListPage',
        contentClass: listStyles.page,
        contentCss: listCss,
        contentSelector: '.page',
        maxWidth: 48 * 16,
        render: () => <ListPage><article>History card</article></ListPage>,
    },
    {
        name: 'Send',
        source: readRepoFile('packages/core/src/shared/routes/Send.jsx'),
        template: 'FormPage',
        contentClass: formStyles.form,
        contentCss: formCss,
        contentSelector: '.form',
        maxWidth: 560,
        render: () => (
            <FormPage label="Send" actions={<button type="submit">Send</button>}>
                <label htmlFor="desktop-send-address">To</label>
                <input id="desktop-send-address" />
            </FormPage>
        ),
    },
    {
        name: 'Settings',
        source: readRepoFile('packages/core/src/shared/routes/Settings.jsx'),
        template: 'ListPage',
        contentClass: listStyles.page,
        contentCss: listCss,
        contentSelector: '.page',
        maxWidth: 48 * 16,
        render: () => <ListPage><article>Settings card</article></ListPage>,
    },
];

function mountRoute(route, width) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    return render(
        <FullLayoutWithNav
            nav={<LeftNav currentView={route.name.toLowerCase()} onSelect={() => {}} />}
        >
            {route.render()}
        </FullLayoutWithNav>,
    );
}

afterEach(() => cleanup());

describe.each(DESKTOP_WIDTHS)('desktop shell route rendering at %ipx', (width) => {
    it.each(ROUTES)('keeps $name in its readable content column', (route) => {
        const { container } = mountRoute(route, width);

        const shell = container.querySelector('[data-xc-tier]');
        expect(shell).toHaveAttribute('data-xc-tier', 'full');
        expect(shell.querySelector(`.${layoutStyles.sidebar}`)).not.toBeNull();
        expect(route.source).toMatch(new RegExp(`<${route.template}\\b`));

        expect(shell.querySelector(`.${route.contentClass}`)).not.toBeNull();

        const sidebarWidth = lengthInPixels(
            ruleBodies(layoutCss, '.sidebar'),
            /flex:\s*0 0\s*(\d+(?:\.\d+)?)(px|rem)/,
        );
        const contentRules = ruleBodies(route.contentCss, route.contentSelector);
        const contentWidth = lengthInPixels(
            contentRules,
            /max-width:\s*(\d+(?:\.\d+)?)(px|rem)/,
        );
        expect(sidebarWidth).toBe(220);
        expect(contentWidth).toBe(route.maxWidth);
        expect(contentRules.some((rule) => /width:\s*100%/.test(rule))).toBe(true);
        expect(contentRules.some((rule) => /margin(?:-inline)?:[^;]*auto/.test(rule))).toBe(true);
        expect(contentWidth).toBeLessThan(width - sidebarWidth);
    });
});
