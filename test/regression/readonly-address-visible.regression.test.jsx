// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: read-only address visibility.
//
//   [P1] 2026-10-13: The opaque input can cover its read-only address and
//        action icon unless both overlays occupy a higher stacking layer.
//        The visible address also remains available to assistive technology.

import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AddressField } from '../../packages/core/src/ui/AddressField.jsx';
import addressFieldStyles from '../../packages/core/src/ui/AddressField.module.css';
import inputStyles from '../../packages/core/src/ui/Input.module.css';

const ADDRESS = 'bc1qsourceaddressforstacking';
const addressFieldCss = readFileSync('packages/core/src/ui/AddressField.module.css', 'utf8');
const inputCss = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

afterEach(() => cleanup());

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `${selector} rule`).toBeTruthy();
    return match[1];
}

function tokenValue(name) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
    expect(match, name).toBeTruthy();
    return match[1].trim();
}

function zIndexOf(body) {
    const declared = /z-index:\s*([^;]+);/.exec(body)?.[1];
    if (!declared) return 0;
    const expression = declared
        .replace(/var\((--[\w-]+)\)/g, (_, name) => tokenValue(name))
        .replace(/^calc\((.*)\)$/, '$1');
    const match = /^\s*(-?\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(expression);
    expect(match, `z-index ${declared}`).toBeTruthy();
    const base = Number(match[1]);
    if (!match[2]) return base;
    return match[2] === '+' ? base + Number(match[3]) : base - Number(match[3]);
}

describe('regression/read-only-address-visible', () => {
    it('[REGRESSION P1] keeps the address overlay and icon visible above the input', () => {
        const { container } = render(
            <AddressField
                label="From"
                icon="addresses"
                onIconClick={() => {}}
                value={ADDRESS}
                readOnly
            />,
        );

        const input = screen.getByLabelText('From');
        const overlay = container.querySelector(`.${addressFieldStyles.readOnlyValue}`);
        const icon = screen.getByRole('button', { name: 'Choose address' });
        expect(input).toHaveClass(inputStyles.input);
        expect(overlay).toHaveClass(addressFieldStyles.readOnlyValue);
        expect(icon).toHaveClass(addressFieldStyles.iconButton);

        const inputRule = ruleBody(inputCss, '.controlHitArea > .input');
        expect(inputRule).toMatch(/position:\s*relative/);
        const inputZIndex = zIndexOf(inputRule);
        for (const selector of ['.readOnlyValue', '.iconButton']) {
            const overlayRule = ruleBody(addressFieldCss, selector);
            expect(overlayRule).toMatch(/position:\s*absolute/);
            expect(zIndexOf(overlayRule)).toBeGreaterThan(inputZIndex);
        }

        expect(overlay).toHaveTextContent('bc1qso…acking');
        expect(overlay).not.toHaveAttribute('aria-hidden');
        expect(overlay.querySelector(`[aria-label="${ADDRESS}"]`)).not.toHaveAttribute('aria-hidden');
    });
});
