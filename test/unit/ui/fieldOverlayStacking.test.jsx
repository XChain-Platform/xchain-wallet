// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Content drawn over a kit Input (the read-only address preview, a picker
// icon, the password toggle) must stack above the input. The input is
// positioned and has an opaque background, so an overlay without its own
// layer above the input's paints underneath it: on the phone the From and
// Receive address fields rendered as empty white boxes.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';

afterEach(() => cleanup());

const css = (path) => readFileSync(path, 'utf8');
const tokens = css('packages/core/src/ui/tokens.css');
const inputCss = css('packages/core/src/ui/Input.module.css');
const addressFieldCss = css('packages/core/src/ui/AddressField.module.css');
const comboboxCss = css('packages/core/src/ui/AddressCombobox.module.css');
const lockedCss = css('packages/core/src/shared/routes/Locked.module.css');

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    expect(match, `${selector} rule`).toBeTruthy();
    return match[1];
}

function tokenValue(name) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
    expect(match, name).toBeTruthy();
    return match[1].trim();
}

/** Resolves a z-index declaration to a number; no declaration stacks at 0. */
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

const inputLayer = zIndexOf(ruleBody(inputCss, '.controlHitArea > .input'));

describe('overlays drawn on a kit Input', () => {
    it.each([
        ['AddressField address preview', addressFieldCss, '.readOnlyValue'],
        ['AddressField picker icon', addressFieldCss, '.iconButton'],
        ['AddressCombobox picker icon', comboboxCss, '.iconButton'],
        ['Locked password toggle', lockedCss, '.passwordToggle'],
    ])('stacks the %s above the input', (_name, text, selector) => {
        const body = ruleBody(text, selector);
        expect(body).toMatch(/position:\s*absolute/);
        expect(zIndexOf(body)).toBeGreaterThan(inputLayer);
    });

    it('renders the read-only address and its picker icon over the input', () => {
        const { container } = render(
            <AddressField
                label="From"
                icon="addresses"
                onIconClick={() => {}}
                value="bc1qsourceaddressforstacking"
                readOnly
            />,
        );

        const input = screen.getByLabelText('From');
        const preview = container.querySelector('[class*="readOnlyValue"]');
        const icon = container.querySelector('button[class*="iconButton"]');

        expect(preview).not.toBeNull();
        // The single-line preview truncates the middle of the address.
        expect(preview.textContent).toMatch(/^bc1qso.*acking$/);
        expect(icon).not.toBeNull();
        // Equal layers paint in tree order, so both overlays also follow the input.
        for (const overlay of [preview, icon]) {
            expect(input.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });
});
