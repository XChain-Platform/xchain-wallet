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

        expect(ads).toMatch(/import \{ Icon, Input, Notice, Select \} from '@xchain-wallet\/core\/ui'/);
        // Per transaction and Send at share one AmountRow: the kit Select on
        // the row and the kit Input that Custom opens under it; Donate to is the
        // shared inline row's kit Select. Select wears Input's control class, so
        // every field takes the kit heights.
        expect(ads.match(/<Input\s/g)).toHaveLength(1);
        expect(ads.match(/<Select\s/g)).toHaveLength(1);
        expect(source('packages/core/src/ui/Select.jsx')).toMatch(/import styles from '\.\/Input\.module\.css'/);
        expect(rule(inputCss, '.input:not(textarea)')).toMatch(/height:\s*var\(--xc-control-height\)/);
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

        expect(screen.getByRole('heading', { level: 1, name: 'Add Wallet' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallets' }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('separates later Display headings with shared form sections', () => {
        const display = source('packages/core/src/shared/components/settings/DisplaySection.jsx');

        // Each Display group is its own FormSection card, which owns the gap
        // between groups, so no ad hoc section header margins remain.
        // Four groups remain: balances, row buttons, saved network filters and
        // the reset; the watched, pinned and hidden token lists moved to the
        // Tokens page (TokenListsSection) on 2026-11-14.
        expect(display.match(/<FormSection\b/g)).toHaveLength(4);
        expect(display).not.toMatch(/SectionHeader/);
        // Display now opens as row pages: a group opened on its own row page
        // drops its card title, since the page header already names it.
        expect(display).toContain("<FormSection title={only ? undefined : 'Balance display'}>");
    });
});
