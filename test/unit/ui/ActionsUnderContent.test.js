// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The unlock screen's actions sit under its content with the form gap alone.
// A reserved error line under the idle password field adds the help gap plus
// one xs line on top of the form gap, so the gap above Unlock Wallet reads
// about 35px where every other form reads 16px.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Class names resolve to their own keys so the render shows which rules apply.
vi.mock('../../../packages/core/src/shared/routes/Locked.module.css', () => ({
    default: new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    clearDemoWalletId,
    clearLockoutState,
    setBiometricProvider,
} from '../../../packages/core/src/flows/index.js';

const CSS_PATH = 'packages/core/src/shared/routes/Locked.module.css';
const css = readFileSync(join(process.cwd(), CSS_PATH), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBodies(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[\\n,}])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
    return [...source.matchAll(pattern)].map((match) => match[1]);
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    setBiometricProvider(null);
});

afterEach(() => {
    cleanup();
    clearLockoutState();
    setBiometricProvider(null);
});

describe('Unlock actions sit under the content with the form gap', () => {
    it('adds no block-end space under the idle password field', () => {
        for (const selector of ['.passwordField', '.passwordFieldIdle']) {
            for (const body of ruleBodies(css, selector)) {
                expect(body, `${selector} in ${CSS_PATH}`).not.toMatch(
                    /(padding|margin)(-block-end|-block|-bottom)?\s*:/,
                );
            }
        }
    });

    it('renders the password field as the last body row with no reserved-space class', () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'popup', messaging: { unlockWallet: vi.fn() } },
            React.createElement(Locked, { onUnlocked: vi.fn() }),
        ));

        const input = screen.getByLabelText('Password');
        const field = input.closest('.passwordField');
        expect(field).not.toBeNull();
        expect([...field.classList]).toEqual(['passwordField']);

        const button = screen.getByRole('button', { name: 'Unlock Wallet' });
        const form = button.closest('form');
        expect(form.contains(field)).toBe(true);
        // The field comes before the button, and no element sits between the
        // field and the end of its body container.
        expect(field.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(field.nextElementSibling).toBeNull();
    });
});
