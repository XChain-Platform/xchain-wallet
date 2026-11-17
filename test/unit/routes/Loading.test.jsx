// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Loading } from '../../../packages/core/src/shared/routes/Loading.jsx';

afterEach(cleanup);

function renderLoading(props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Loading {...props} />
        </MessagingProvider>,
    );
}

describe('Loading error recovery', () => {
    it('shows plain recovery copy without rendering the raw error object', () => {
        const error = new Error('database password and internal path');
        renderLoading({ error });

        expect(screen.getByRole('heading', { name: 'Wallet Unavailable' })).toBeTruthy();
        expect(screen.getByText(/data is safe and unchanged.*restart the app/i)).toBeTruthy();
        expect(screen.queryByText(/support/i)).toBeNull();
        expect(screen.queryByText(/database password/i)).toBeNull();
        expect(screen.queryByText(/internal path/i)).toBeNull();
    });

    it('calls the retry action when Try again is chosen', () => {
        const onRetry = vi.fn();
        renderLoading({ error: 'raw startup failure', onRetry });

        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps the notice and retry list in the same form container', () => {
        renderLoading({ error: 'raw startup failure' });
        const notice = screen.getByText(/data is safe and unchanged/i).closest('[data-tone]');
        const actions = screen.getByRole('list', { name: 'Recovery actions' });

        expect(notice?.closest('form')).toBe(actions.closest('form'));
        expect(actions.closest('form')).not.toBeNull();
    });
});

describe('Boot screen look', () => {
    const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
    const shellPages = [
        'packages/web/index.html',
        'packages/desktop/renderer/index.html',
        'packages/extension/popup.html',
        'packages/extension/sidepanel.html',
    ];

    it('fades the logo, slides one bar and holds both still under reduced motion', () => {
        const css = read('packages/core/src/shared/routes/Loading.module.css');
        const bootBarCss = css.slice(css.indexOf('.bootBar {'), css.indexOf('@keyframes bootFade'));
        expect(css).toMatch(/\.bootLogo\s*\{[^}]*animation:\s*bootFade 0\.8s ease-out both/s);
        expect(css).toMatch(/@keyframes bootFade\s*\{\s*from\s*\{\s*opacity:\s*0\.1/);
        expect(css).toMatch(/\.bootBarFill\s*\{[^}]*animation:\s*bootSlide/s);
        expect(css).toMatch(/\.bootBar\s*\{[^}]*inline-size:\s*152px[^}]*block-size:[^}]*margin-block-start:/s);
        expect(css).toMatch(/\.bootBarFill\s*\{[^}]*inset-block:\s*0[^}]*inset-inline-start:\s*0[^}]*inline-size:\s*40%/s);
        expect(css).toMatch(/@keyframes bootSlide\s*\{\s*from\s*\{\s*inset-inline-start:\s*-40%;\s*\}\s*to\s*\{\s*inset-inline-start:\s*100%;/);
        expect(css).not.toMatch(/pulse/i);
        expect(bootBarCss).not.toMatch(/translateX|\b(?:top|right|bottom|left|width|height|margin-top)\s*:/);
        const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\}\s*\}/)[0];
        expect(reduced).toMatch(/\.bootLogo\s*\{\s*animation:\s*none/);
        expect(reduced).toMatch(/\.bootBarFill\s*\{\s*animation:\s*none;\s*inline-size:\s*100%/);
        expect(reduced).not.toMatch(/\bwidth\s*:/);
    });

    it.each(shellPages)('%s paints the same boot markup before the bundle loads', (page) => {
        const html = read(page);
        expect(html).toMatch(/<div class="xc-boot" role="status" aria-label="Opening your wallet">/);
        expect(html).toMatch(/animation: xc-boot-fade 0\.8s ease-out both/);
        expect(html).toMatch(/prefers-reduced-motion: reduce\) \{ \.xc-boot img \{ animation: none; \}/);
        expect(html).toMatch(/<div class="xc-boot-bar" role="progressbar" aria-label="Opening your wallet"><span><\/span><\/div>/);
        expect(html).toMatch(/animation: xc-boot-slide 1\.2s ease-in-out infinite/);
        expect(html).toMatch(/@keyframes xc-boot-slide \{ from \{ inset-inline-start: -40%; \} to \{ inset-inline-start: 100%; \} \}/);
        const bootBarCss = html.match(/\.xc-boot \.xc-boot-bar \{[^}]+\}[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{ \.xc-boot \.xc-boot-bar > span \{[^}]+\} \}/)[0];
        expect(bootBarCss).toMatch(/inline-size: 152px; block-size: 4px; margin-block-start: 16px/);
        expect(bootBarCss).toMatch(/inset-block: 0; inset-inline-start: 0; inline-size: 40%/);
        expect(bootBarCss).not.toMatch(/translateX|\b(?:top|right|bottom|left|width|height|margin-top)\s*:/);
    });

    it('keeps one logo data URI under 8 KB across all four shell pages', () => {
        const uris = shellPages.map((page) => read(page).match(/src="(data:image\/png;base64,[^"]+)"/)[1]);
        expect(new Set(uris).size).toBe(1);
        expect(uris[0].length).toBeLessThan(8 * 1024);
    });
});

describe('Recovery screen phone layouts', () => {
    it('uses the shared 600px centered form card rule', () => {
        const formCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/ui/FormPage.module.css'),
            'utf8',
        );
        const wideForm = formCss.match(
            /@media \(min-width: 600px\)[\s\S]*?\.form\s*\{([^}]*)\}/,
        )[1];

        expect(wideForm).toMatch(/max-width:\s*var\(--xc-form-card-max-width\)/);
        expect(wideForm).toMatch(/margin:\s*0 auto/);
        expect(wideForm).toMatch(/background:\s*var\(--xc-card-bg\)/);
        expect(wideForm).toMatch(/border:\s*var\(--xc-card-border\)/);
    });

    it('keeps the loading error panel within the available 360px width', () => {
        const loadingCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/Loading.module.css'),
            'utf8',
        );
        const panel = loadingCss.match(/\.errorPanel\s*\{[^}]*\}/)[0];

        expect(panel).toMatch(/width:\s*100%/);
        expect(panel).toMatch(/min-width:\s*0/);
        expect(panel).toMatch(/max-width:\s*480px/);
        expect(panel).toMatch(/box-sizing:\s*border-box/);
    });

    it('lets vault recovery copy and actions wrap within 360px', () => {
        const vaultCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/VaultUnavailable.module.css'),
            'utf8',
        );
        const wrap = vaultCss.match(/\.wrap\s*\{[^}]*\}/)[0];
        // The restore action is a kit Button, so its wrapping lives on .btn.
        const buttonCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/ui/Button.module.css'),
            'utf8',
        );
        const restoreAction = buttonCss.match(/\.btn\s*\{[^}]*\}/)[0];

        expect(wrap).toMatch(/width:\s*100%/);
        expect(wrap).toMatch(/min-width:\s*0/);
        expect(wrap).toMatch(/max-width:\s*100%/);
        expect(wrap).toMatch(/overflow-wrap:\s*anywhere/);
        expect(restoreAction).toMatch(/max-width:\s*100%/);
        expect(restoreAction).toMatch(/white-space:\s*normal/);
    });
});
