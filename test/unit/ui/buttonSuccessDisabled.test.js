// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G130 (operator 2026-11-16) reverses the shared disabled treatment of the
// night before: no Button variant changes when disabled. Every variant keeps
// its own fill, the global token sheet no longer desaturates buttons, and
// Remove Wallet needs no red exception of its own.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

function declarations(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[1] : null;
}

describe('disabled Button variants', () => {
    const button = read('packages/core/src/ui/Button.module.css');
    const tokens = read('packages/core/src/ui/tokens.css');
    const removeWallet = read('packages/core/src/shared/components/settings/ThisWalletSection.module.css');
    const variants = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success', 'rowAction'];

    it.each(variants)('%s keeps its own look when disabled', (variant) => {
        expect(declarations(button, `.${variant}`)).not.toBeNull();
        expect(button).not.toMatch(new RegExp(`\\.${variant}:disabled\\s*\\{`));
    });

    it('has no shared disabled rule on the button or in the token sheet', () => {
        expect(declarations(button, '.btn:disabled')).toBeNull();
        expect(declarations(button, '.btn:disabled:not(.link):not(.success)')).toBeNull();
        expect(declarations(tokens, ':where(input, select, textarea, button):disabled')).toBeNull();
        expect(declarations(tokens, ':where(input, select, textarea):disabled')).toMatch(/saturate/);
        expect(declarations(button, '.success')).toMatch(/background:\s*var\(--xc-success-fill\)/);
    });

    it('needs no Remove Wallet exception', () => {
        expect(declarations(removeWallet, '.removeFinal:disabled')).toBeNull();
    });
});
