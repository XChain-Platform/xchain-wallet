// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';

function source(path) {
    return withEnglishCopy(readFileSync(path, 'utf8'));
}

function rule(css, selector) {
    return css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('K51 small-screen UI', () => {
    it('uses standard kit heights for ADS amounts and wraps placeholder prose at words', () => {
        const ads = source('packages/core/src/shared/components/settings/AdsSection.jsx');
        const inputCss = source('packages/core/src/ui/Input.module.css');

        expect(ads).toMatch(/import \{ (?:EmptyState, )?InfoTip, Input, Select \} from '@xchain-wallet\/core\/ui'/);
        // The amount fields share one AmountField, the donation address is a
        // read-only kit Input and the recipient picker is the kit Select, which
        // wears Input's control class, so every field takes the kit heights.
        expect(ads.match(/<Input\s/g)).toHaveLength(3);
        expect(ads.match(/<Select\s/g)).toHaveLength(1);
        expect(source('packages/core/src/ui/Select.jsx')).toMatch(/import styles from '\.\/Input\.module\.css'/);
        expect(rule(inputCss, '.input:not(textarea)')).toMatch(/height:\s*var\(--xc-control-height\)/);
    });

    it('keeps the active wallet ring inside the clipped name region', () => {
        const pickerCss = source('packages/core/src/shared/routes/WalletPicker.module.css');
        const rowName = rule(pickerCss, '.rowName');

        expect(rowName).toMatch(/padding-block:\s*var\(--xc-space-1\)/);
        expect(rowName).toMatch(/padding-inline:\s*var\(--xc-space-1\)/);
        expect(rowName).toMatch(/margin-block:\s*calc\(0px - var\(--xc-space-1\)\)/);
        expect(rowName).toMatch(/margin-inline:\s*calc\(var\(--xc-space-1\) \* -1\)/);
        expect(rowName).toMatch(/overflow:\s*hidden/);
    });

    it('gives Add wallet the shared titled page header', () => {
        localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        const onBack = vi.fn();

        render(
            <MessagingContext.Provider value={{ shell: 'popup', messaging: {} }}>
                <Onboarding
                    mode="add"
                    onBack={onBack}
                    onCreate={() => {}}
                    onImport={() => {}}
                    onImportFromFreeWallet={() => {}}
                />
            </MessagingContext.Provider>,
        );

        expect(screen.getByRole('heading', { level: 1, name: 'Add wallet' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallets' }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('separates later Display headings with shared form sections', () => {
        const display = source('packages/core/src/shared/components/settings/DisplaySection.jsx');

        // Each Display group is its own FormSection card, which owns the gap
        // between groups, so no ad hoc section header margins remain.
        expect(display.match(/<FormSection\b/g)).toHaveLength(7);
        expect(display).not.toMatch(/SectionHeader/);
        expect(display).toContain('<FormSection title="Balance display">');
    });
});
