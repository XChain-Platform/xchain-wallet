// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('Connect approval spacing', () => {
    const connectCss = read('packages/extension/src/approval/kinds/ConnectApproval.module.css');
    const formPageCss = read('packages/core/src/ui/FormPage.module.css');
    const tokens = read('packages/core/src/ui/tokens.css');

    it('keeps eight pixels between the Accounts field and permissions notice at every width', () => {
        expect(tokens).toMatch(/--xc-space-2:\s*8px/);
        expect(connectCss).toMatch(
            /\.page \[data-picker-field="connect-accounts"\] \+ \[data-connect-permissions\]\s*\{[^}]*margin-block-start:\s*calc\(var\(--xc-space-2\) - var\(--xc-form-gap\)\)/s,
        );
        expect(connectCss).not.toMatch(
            /@media[^}]*\.page \[data-picker-field="connect-accounts"\] \+ \[data-connect-permissions\]/s,
        );
    });

    it('retains the FormPage card from 600px', () => {
        expect(formPageCss).toMatch(
            /@media \(min-width: 600px\)[\s\S]*?\.form\s*\{[^}]*max-width:\s*var\(--xc-form-card-max-width\);[^}]*border:\s*var\(--xc-card-border\)/,
        );
    });
});
