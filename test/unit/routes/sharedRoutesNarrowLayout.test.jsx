// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import '../../../packages/core/src/ui/tokens.css';

const VIEWPORT_WIDTHS = [320, 360, 412];
// The K51 accessibility venue applies Android's 1.3 font scale to the
// 16px browser root; the average glyph ratio models XChain Sans in jsdom.
const K51_FONT_SCALE = 1.3;
const K51_ROOT_FONT_PX = 16 * K51_FONT_SCALE;
const K51_AVERAGE_GLYPH_EM = 0.535;

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);

const routeEntries = Object.keys(routeModules)
    .map((path) => [path, path.slice(path.lastIndexOf('/') + 1)])
    .sort((a, b) => a[1].localeCompare(b[1]));

const pendingMessaging = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
);

const props = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    chainId: 'bitcoin-mainnet',
    actionIndex: '1',
    contractId: '1',
    dispenserId: '1',
    divisibility: 0,
    mode: 'transfer',
    tick: 'XCHAIN',
    tick1: 'BTC',
    tick2: 'XCHAIN',
    entries: [],
    listRef: {
        chainId: 'bitcoin-mainnet',
        actionIndex: '1',
        type: '1',
        items: [],
    },
    addresses: [{
        id: 'address-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        source: 'hd',
    }],
    address: {
        id: 'address-1',
        address: 'bc1qexampleexampleexampleexampleexampleex',
        source: 'watch',
        chain: 'bitcoin',
        network: 'mainnet',
        derivationPath: null,
        label: '',
    },
    onBack() {},
    onClose() {},
    onDone() {},
    onNavigate() {},
    onSelect() {},
};

async function resolveComponent(importer, file) {
    const module = await routeModules[importer]();
    const name = file.replace(/\.jsx$/, '');
    return module[name]
        || Object.values(module).find((value) => typeof value === 'function')
        || null;
}

function pixels(value, basis) {
    if (!value || value === 'auto' || value === 'none') return null;
    const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%)$/.exec(value.trim());
    if (!match) return null;
    const number = Number(match[1]);
    if (match[2] === 'px') return number;
    if (match[2] === '%') return basis * number / 100;
    return number * K51_ROOT_FONT_PX;
}

function horizontalInsets(style, basis) {
    return ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
        .reduce((total, property) => total + (pixels(style[property], basis) || 0), 0);
}

function k51TextWidth(element, style) {
    if (element.children.length > 0) return 0;
    const text = (element.value || element.textContent || '').trim();
    if (!text) return 0;
    const fontSize = pixels(style.fontSize, K51_ROOT_FONT_PX) || K51_ROOT_FONT_PX;
    const letterSpacing = pixels(style.letterSpacing, fontSize) || 0;
    return text.length * ((fontSize * K51_AVERAGE_GLYPH_EM) + letterSpacing);
}

function fixedTrackFloor(template) {
    if (!template || template === 'none') return 0;
    return Array.from(template.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)(px|rem)(?=\s|$)/g))
        .reduce((total, match) => total + Number(match[1])
            * (match[2] === 'rem' ? K51_ROOT_FONT_PX : 1), 0);
}

function measureTree(element, availableWidth) {
    const style = getComputedStyle(element);
    if (style.display === 'none') {
        Object.defineProperties(element, {
            clientWidth: { configurable: true, value: 0 },
            scrollWidth: { configurable: true, value: 0 },
        });
        return { clientWidth: 0, scrollWidth: 0 };
    }

    const insets = horizontalInsets(style, availableWidth);
    const declaredWidth = pixels(style.width, availableWidth);
    const maxWidth = pixels(style.maxWidth, availableWidth);
    const minWidth = pixels(style.minWidth, availableWidth) || 0;
    let clientWidth = declaredWidth ?? availableWidth;
    if (maxWidth !== null) clientWidth = Math.min(clientWidth, maxWidth);
    clientWidth = Math.max(0, Math.max(clientWidth, minWidth));

    const contentWidth = Math.max(0, clientWidth - insets);
    const childMetrics = Array.from(element.children)
        .map((child) => measureTree(child, contentWidth));
    const textWidth = k51TextWidth(element, style) + insets;
    const nowrapTextWidth = style.whiteSpace === 'nowrap' ? textWidth : 0;
    const gridFloor = fixedTrackFloor(style.gridTemplateColumns) + insets;
    let childrenWidth = childMetrics.reduce(
        (widest, child) => Math.max(widest, child.scrollWidth + insets),
        0,
    );
    if (style.display === 'flex' && style.flexDirection !== 'column'
        && style.flexWrap === 'nowrap') {
        childrenWidth = childMetrics.reduce((total, child) => total + child.clientWidth, 0)
            + insets;
    }
    const measuredClientWidth = Math.round(clientWidth);
    const measuredScrollWidth = Math.max(measuredClientWidth, Math.ceil(
        Math.max(minWidth, nowrapTextWidth, gridFloor, childrenWidth),
    ));
    Object.defineProperties(element, {
        clientWidth: { configurable: true, value: measuredClientWidth },
        scrollWidth: { configurable: true, value: measuredScrollWidth },
    });
    return {
        clientWidth: measuredClientWidth,
        scrollWidth: measuredScrollWidth,
    };
}

function describeElement(element) {
    const classes = Array.from(element.classList).join('.');
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
}

let savedMatchMedia;
let savedResizeObserver;
let savedInnerWidth;
let savedClientWidth;
beforeAll(() => {
    savedMatchMedia = globalThis.matchMedia;
    savedResizeObserver = globalThis.ResizeObserver;
    savedInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    savedClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.matchMedia = savedMatchMedia;
    globalThis.ResizeObserver = savedResizeObserver;
    if (savedInnerWidth) Object.defineProperty(window, 'innerWidth', savedInnerWidth);
    if (savedClientWidth) {
        Object.defineProperty(document.documentElement, 'clientWidth', savedClientWidth);
    }
});

describe('K51 layout metric calibration', () => {
    it('detects text wider than a fixed no-wrap container', () => {
        const { container } = render(
            <div style={{ width: '40px', whiteSpace: 'nowrap' }}>
                Wallet address
            </div>,
        );
        const element = container.firstElementChild;
        measureTree(element, 40);
        expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
    });
});

describe.each(VIEWPORT_WIDTHS)('shared route layout at %ipx', (viewportWidth) => {
    routeEntries.forEach(([importer, file]) => {
        it(file, async () => {
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: viewportWidth,
            });
            Object.defineProperty(document.documentElement, 'clientWidth', {
                configurable: true,
                value: viewportWidth,
            });
            globalThis.matchMedia = (query) => ({
                matches: (!query.match(/max-width:\s*(\d+)px/)
                        || viewportWidth <= Number(query.match(/max-width:\s*(\d+)px/)[1]))
                    && (!query.match(/min-width:\s*(\d+)px/)
                        || viewportWidth >= Number(query.match(/min-width:\s*(\d+)px/)[1])),
                media: query,
                onchange: null,
                addEventListener() {},
                removeEventListener() {},
                addListener() {},
                removeListener() {},
                dispatchEvent() { return false; },
            });

            const Component = await resolveComponent(importer, file);
            if (!Component) return;
            const { container } = render(
                <div data-testid="layout-viewport" style={{ width: `${viewportWidth}px` }}>
                    <MessagingProvider shell="web" messaging={pendingMessaging}>
                        <Component {...props} />
                    </MessagingProvider>
                </div>,
            );

            measureTree(container.firstElementChild, viewportWidth);
            const offenders = Array.from(container.querySelectorAll('*'))
                .filter((element) => element.scrollWidth > element.clientWidth)
                .map((element) => `${describeElement(element)} ${element.scrollWidth}>${element.clientWidth}`);

            expect(offenders, `${file} overflows at ${viewportWidth}px`).toEqual([]);
        });
    });
});
