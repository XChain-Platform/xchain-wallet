// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { NetworkBanner } from '../../../packages/core/src/shared/components/NetworkBanner.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';

function source(path) {
    return readFileSync(path, 'utf8');
}

function rule(css, selector) {
    return css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('K51 small-screen UI', () => {
    it('uses a tokenized gap around the network separator', () => {
        render(<NetworkBanner activeNetwork="testnet" />);

        const banner = screen.getByRole('status');
        expect(banner).toHaveTextContent('Testnet·Not mainnet');
        expect(banner.style.gap).toBe('var(--xc-space-1, 4px)');
        expect(banner.children[1]).toHaveTextContent(/^·$/);
    });

    it('uses standard kit heights for ADS amounts and wraps placeholder prose at words', () => {
        const ads = source('packages/core/src/shared/components/settings/AdsSection.jsx');
        const inputCss = source('packages/core/src/ui/Input.module.css');

        expect(ads).toMatch(/import \{ InfoTip, Input \} from '@xchain-wallet\/core\/ui'/);
        expect(ads.match(/<Input\s/g)).toHaveLength(2);
        expect(ads).toMatch(/const PLACEHOLDER_ADDRESS_BOX = \{[\s\S]*?wordBreak: 'normal',[\s\S]*?overflowWrap: 'break-word'/);
        expect(rule(inputCss, '.input:not(textarea)')).toMatch(/height:\s*var\(--xc-control-height\)/);
    });

    it('keeps the active wallet ring inside the clipped name region', () => {
        const pickerCss = source('packages/core/src/shared/routes/WalletPicker.module.css');
        const rowName = rule(pickerCss, '.rowName');

        expect(rowName).toMatch(/padding-block:\s*var\(--xc-space-1\)/);
        expect(rowName).toMatch(/margin-block:\s*calc\(0px - var\(--xc-space-1\)\)/);
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

    it('separates later Display headings with the shared section gap', () => {
        const display = source('packages/core/src/shared/components/settings/DisplaySection.jsx');
        const displayCss = source('packages/core/src/shared/components/settings/DisplaySection.module.css');

        expect(display.match(/className=\{layoutStyles\.sectionHeader\}/g)).toHaveLength(6);
        expect(rule(displayCss, '.sectionHeader'))
            .toMatch(/margin-block-start:\s*calc\(var\(--xc-section-gap\) - var\(--xc-space-1\)\)/);
        expect(display).toContain('<SectionHeader as="h3" title="Balance display" />');
    });
});
