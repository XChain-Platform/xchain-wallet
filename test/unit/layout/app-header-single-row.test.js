// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import styles from '../../../packages/core/src/shared/components/AppHeader.module.css';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const initialWidth = window.innerWidth;
const widths = [320, 360, 400, 1280];
const surfaces = [
    { name: 'web', shell: 'web' },
    { name: 'extension popup', shell: 'popup', toolbarPopup: true },
    { name: 'extension side panel', shell: 'popup', extensionSurface: 'sidepanel' },
];
const cases = surfaces.flatMap((surface) => widths.map((width) => [surface.name, width, surface]));
const appHeaderCss = readFileSync(resolve(
    process.cwd(),
    'packages/core/src/shared/components/AppHeader.module.css',
), 'utf8');
// Vitest exposes module class names without attaching CSS in jsdom. Mapping
// source selectors to those class names keeps computed styles tied to the module.
const compiledAppHeaderCss = appHeaderCss
    .replace(/:global\(([^)]+)\)/g, '$1')
    .replace(/\.([_a-zA-Z][\w-]*)/g, (selector, localName) => (
        styles[localName] ? `.${styles[localName]}` : selector
    ));

function renderSurface(surface, width) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    document.documentElement.style.width = `${width}px`;
    document.documentElement.classList.toggle('xchain-toolbar-popup', Boolean(surface.toolbarPopup));
    if (surface.extensionSurface) {
        document.documentElement.dataset.xcExtensionSurface = surface.extensionSurface;
    } else {
        delete document.documentElement.dataset.xcExtensionSurface;
    }

    const stylesheet = document.createElement('style');
    stylesheet.dataset.testStylesheet = 'app-header';
    stylesheet.textContent = compiledAppHeaderCss;
    document.head.append(stylesheet);

    return render(React.createElement(
        MessagingProvider,
        {
            shell: surface.shell,
            messaging: { getSettings: async () => ({}) },
        },
        React.createElement(AppHeader, {
            activeNetwork: surface.name === 'web' ? 'testnet' : 'regtest',
            onLock: () => {},
            onMenuOpen: () => {},
        }),
    ));
}

afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
    document.documentElement.style.width = '';
    document.documentElement.classList.remove('xchain-toolbar-popup');
    delete document.documentElement.dataset.xcExtensionSurface;
    document.querySelector('style[data-test-stylesheet="app-header"]')?.remove();
});

describe('AppHeader single-row surfaces', () => {
    it.each(cases)('keeps %s at %ipx free of network status chrome', (_name, width, surface) => {
        renderSurface(surface, width);

        const header = screen.getByRole('region', { name: 'App header' });
        const logo = within(header).getByRole('img');
        const logoGroup = logo.parentElement;
        const buttonGroup = header.querySelector(`.${styles.right}`);
        const headerStyle = getComputedStyle(header);
        const buttonGroupStyle = getComputedStyle(buttonGroup);

        expect(header.querySelector('[data-network-status-trigger]')).toBeNull();
        expect(within(header).queryByRole('button', { name: /network/i })).toBeNull();
        expect(within(header).queryByText(/regtest|testnet/i)).toBeNull();

        expect(logoGroup.parentElement).toBe(header);
        expect(buttonGroup.parentElement).toBe(header);
        expect(logoGroup.nextElementSibling).toBe(buttonGroup);
        expect(headerStyle.display).toBe('flex');
        expect(headerStyle.flexDirection || 'row').toBe('row');
        expect(headerStyle.flexWrap || 'nowrap').toBe('nowrap');
        expect(buttonGroupStyle.display).toBe('flex');
        expect(buttonGroupStyle.flexWrap).toBe('nowrap');
    });
});
