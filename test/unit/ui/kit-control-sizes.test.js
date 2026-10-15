// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it } from 'vitest';

import * as Kit from '../../../packages/core/src/ui/index.js';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/ui');
const tokensCss = readFileSync(join(uiRoot, 'tokens.css'), 'utf8');
const noop = () => {};

const controls = [
    {
        name: 'Button',
        exportName: 'Button',
        cssModule: 'Button.module.css',
        props: { children: 'Continue' },
    },
    {
        name: 'IconButton',
        exportName: 'Button',
        cssModule: 'Button.module.css',
        props: {
            icon: createElement('span', { 'aria-hidden': 'true' }, '+'),
            'aria-label': 'Add wallet',
        },
    },
    {
        name: 'Input',
        exportName: 'Input',
        cssModule: 'Input.module.css',
        props: { 'aria-label': 'Wallet name' },
    },
    {
        name: 'Select',
        exportName: 'Select',
        cssModule: 'Input.module.css',
        props: {
            'aria-label': 'Network',
            children: createElement('option', { value: 'mainnet' }, 'Mainnet'),
        },
    },
    {
        name: 'Checkbox',
        exportName: 'Checkbox',
        cssModule: 'Checkbox.module.css',
        props: { label: 'Back up wallet', checked: false, onChange: noop },
    },
    {
        name: 'RadioGroup',
        exportName: 'RadioGroup',
        cssModule: 'RadioGroup.module.css',
        props: {
            legend: 'Visibility',
            value: 'private',
            onChange: noop,
            options: [{ value: 'private', label: 'Private' }],
        },
    },
    {
        name: 'Switch',
        exportName: 'Switch',
        cssModule: 'Switch.module.css',
        props: { label: 'Price alerts', checked: false, onChange: noop },
    },
    {
        name: 'Chip',
        exportName: 'Chip',
        cssModule: 'Chip.module.css',
        props: { children: 'Watchlist', pressed: false, onPressedChange: noop },
    },
    {
        name: 'Tabs',
        exportName: 'Tabs',
        cssModule: 'Tabs.module.css',
        props: {
            'aria-label': 'Wallet section',
            items: [{ id: 'overview', label: 'Overview' }],
            value: 'overview',
            onChange: noop,
        },
    },
    {
        name: 'ListRow',
        exportName: 'ListRow',
        cssModule: 'ListRow.module.css',
        props: { title: 'Primary account', onClick: noop },
    },
];

const reportOnly = [
    { file: 'Button.module.css', selector: '.btn', property: 'min-height', pixels: '36px', reason: 'The default fallback preserves Button geometry when an older shell omits the tokens.' },
    { file: 'Button.module.css', selector: '.sm', property: 'min-height', pixels: '28px', reason: 'The compact fallback preserves Button geometry when an older shell omits the tokens.' },
    { file: 'Button.module.css', selector: '.md', property: 'min-height', pixels: '36px', reason: 'The default fallback preserves Button geometry when an older shell omits the tokens.' },
    { file: 'Button.module.css', selector: '.lg', property: 'min-height', pixels: '44px', reason: 'The large fallback preserves Button geometry when an older shell omits the tokens.' },
    { file: 'Button.module.css', selector: '.sm::before', property: 'height', pixels: '24px', reason: 'The coarse-pointer hit area falls back to the 24px pointer-target floor when an older shell omits the tokens.' },
    { file: 'Button.module.css', selector: '.btn::after', property: 'min-height', pixels: '44px', reason: 'The transparent coarse-pointer target deliberately enforces a 44px hit area.' },
    { file: 'Input.module.css', selector: ".input:is([type='date'], [type='datetime-local'], [type='time'])::-webkit-calendar-picker-indicator", property: 'height', pixels: '24px', reason: 'The picker glyph falls back to the 24px pointer-target floor when an older shell omits the tokens.' },
    { file: 'Input.module.css', selector: ".input:is([type='date'], [type='datetime-local'], [type='time'])::-webkit-calendar-picker-indicator", property: 'min-height', pixels: '24px', reason: 'The picker glyph falls back to the 24px pointer-target floor when an older shell omits the tokens.' },
    { file: 'Input.module.css', selector: '.controlHitArea::before', property: 'height', pixels: '24px', reason: 'The coarse-pointer hit area falls back to the 24px pointer-target floor when an older shell omits the tokens.' },
    { file: 'Checkbox.module.css', selector: '.root', property: 'min-height', pixels: '44px', reason: 'The whole label row is the touch target, so it keeps 44px at every pointer type and the box never clips.' },
    { file: 'RadioGroup.module.css', selector: '.option', property: 'min-height', pixels: '44px', reason: 'The whole option row is the touch target, so it keeps 44px at every pointer type.' },
    { file: 'ListRow.module.css', selector: '.row', property: 'min-height', pixels: '24px', reason: 'The fallback preserves the pointer-target floor when an older shell omits the tokens.' },
    { file: 'ListRow.module.css', selector: '.interactive', property: 'min-height', pixels: '24px', reason: 'The interactive fallback preserves the pointer-target floor when an older shell omits the tokens.' },
];

const definedControlSizeTokens = new Set(
    [...tokensCss.matchAll(/(--xc-control-(?:h-(?:sm|md|lg)|hit-min|icon-(?:sm|md|lg)|line))\s*:/g)]
        .map((match) => match[1]),
);

function declarationsWithRawPixels(file, css) {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
    const matches = [];

    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim();
        for (const declaration of rule[2].matchAll(/(?:^|;)\s*(height|min-height|line-height)\s*:\s*([^;]+)/g)) {
            const value = declaration[2].trim();
            const pixels = [...value.matchAll(/-?(?:\d+\.?\d*|\.\d+)px\b/g)]
                .map((match) => match[0]);
            const offset = rule.index + rule[0].indexOf('{') + 1 + declaration.index;
            const line = source.slice(0, offset).split('\n').length;

            for (const pixel of pixels) {
                matches.push({ file, selector, property: declaration[1], value, pixels: pixel, line });
            }
        }
    }

    return matches;
}

function reportOnlyReason(declaration) {
    return reportOnly.find((entry) => (
        entry.file === declaration.file
        && entry.selector === declaration.selector
        && entry.property === declaration.property
        && entry.pixels === declaration.pixels
    ))?.reason;
}

function describeDeclaration({ file, selector, property, value, line }) {
    return `${file}:${line} ${selector} { ${property}: ${value}; }`;
}

afterEach(cleanup);

it('detects an unlisted pixel height in a control rule', () => {
    const css = `
        /* min-height: 31px; */
        .fixture {
            height: var(--xc-control-h-md);
            min-height: 31px;
            line-height: 1.25;
        }
    `;

    expect(declarationsWithRawPixels('Fixture.module.css', css)).toEqual([
        {
            file: 'Fixture.module.css',
            selector: '.fixture',
            property: 'min-height',
            value: '31px',
            pixels: '31px',
            line: 4,
        },
    ]);
});

it.each(controls)('$name renders and keeps raw pixel heights out of its CSS module', ({
    name,
    exportName,
    cssModule,
    props,
}) => {
    const Component = Kit[exportName];
    expect(Component, `${name} must be exported from packages/core/src/ui`).toBeDefined();

    const { container } = render(createElement(Component, props));
    expect(container.firstElementChild, `${name} did not render`).not.toBeNull();

    const css = readFileSync(join(uiRoot, cssModule), 'utf8');
    const referencedSizeTokens = [...css.matchAll(/var\((--xc-control-[\w-]+)/g)]
        .map((match) => match[1])
        .filter((token) => definedControlSizeTokens.has(token));
    expect(
        referencedSizeTokens,
        `${cssModule} must reference a defined --xc-control-* size token`,
    ).not.toHaveLength(0);

    const violations = declarationsWithRawPixels(cssModule, css)
        .filter((declaration) => !reportOnlyReason(declaration))
        .map(describeDeclaration);
    expect(violations).toEqual([]);
});
