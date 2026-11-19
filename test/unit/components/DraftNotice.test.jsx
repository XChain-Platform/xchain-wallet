// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DraftNotice } from '../../../packages/core/src/shared/components/DraftNotice.jsx';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const routesDir = join(process.cwd(), 'packages/core/src/shared/routes');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DraftNotice', () => {
    it('uses the notice standard with one full-width Restore action', () => {
        const onRestore = vi.fn();
        const onDiscard = vi.fn();
        render(
            <DraftNotice onRestore={onRestore} onDiscard={onDiscard}>
                Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.
            </DraftNotice>,
        );

        const notice = screen.getByTestId('draft-notice');
        expect(notice).toHaveAttribute('data-tone', 'info');
        expect(screen.getByText('Draft saved').tagName).toBe('DIV');

        const actions = notice.querySelector('[data-draft-actions]');
        const buttons = within(actions).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Restore');
        expect(screen.queryByRole('button', { name: /Discard saved draft/i })).toBeNull();

        fireEvent.click(buttons[0]);
        expect(onRestore).toHaveBeenCalledOnce();
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('uses the close X to discard with a 44px target 8px from the top and right', () => {
        const onRestore = vi.fn();
        const onDiscard = vi.fn();
        render(
            <DraftNotice onRestore={onRestore} onDiscard={onDiscard}>
                Saved draft.
            </DraftNotice>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
        expect(onDiscard).toHaveBeenCalledOnce();
        expect(onRestore).not.toHaveBeenCalled();

        const css = read('packages/core/src/shared/components/DraftNotice.module.css');
        expect(css).toMatch(/\[data-notice-dismiss\][^{]*\{[^}]*top:\s*8px;[^}]*inset-inline-end:\s*8px;[^}]*width:\s*var\(--xc-control-h-lg\);[^}]*height:\s*var\(--xc-control-h-lg\);/s);
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-control-h-lg:\s*44px;/);
    });

    it('spans Restore across the notice inner width', () => {
        const component = read('packages/core/src/shared/components/DraftNotice.jsx');
        const css = read('packages/core/src/shared/components/DraftNotice.module.css');
        expect(component.match(/\bblock\b/g)).toHaveLength(1);
        expect(css).toMatch(/\.actions\s*\{[^}]*width:\s*calc\(100% \+ var\(--xc-icon-sm\) \+ var\(--xc-space-2\)\);/s);
        expect(css).toMatch(/margin-inline-start:\s*calc\(-1 \* \(var\(--xc-icon-sm\) \+ var\(--xc-space-2\)\)\);/);
    });

    it('pads Restore by 8px on every side', () => {
        const component = read('packages/core/src/shared/components/DraftNotice.jsx');
        const css = read('packages/core/src/shared/components/DraftNotice.module.css');
        expect(component).toContain('className={styles.restore}');
        expect(css).toMatch(/\.restore\s*\{[^}]*padding:\s*var\(--xc-space-2\);/s);
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-space-2:\s*8px;/);
    });

    it('guards every restore-capable draft form behind the shared top notice', () => {
        const restoreForms = readdirSync(routesDir)
            .filter((name) => name.endsWith('.jsx'))
            .map((name) => ({
                name,
                source: read(`packages/core/src/shared/routes/${name}`),
            }))
            .filter(({ source }) => source.includes('useFormDraft') && source.includes('const restoreDraft'));

        expect(restoreForms.map(({ name }) => name).sort()).toEqual([
            'DispenserForm.jsx',
            'IssueTokenForm.jsx',
            'Send.jsx',
            'SignMessageForm.jsx',
        ]);
        for (const { name, source } of restoreForms) {
            expect(source, name).toContain("import { DraftNotice } from '../components/DraftNotice.jsx';");
            expect(source, name).toMatch(/const draftBanner[\s\S]{0,1000}<DraftNotice/);
            const banner = source.slice(source.indexOf('const draftBanner'), source.indexOf('</DraftNotice>') + 14);
            expect(banner, name).toContain('onRestore={restoreDraft}');
            expect(banner, name).toContain('onDiscard={discardSavedDraft}');
            expect(banner, name).not.toContain('onDismiss=');
            const frame = source.slice(source.indexOf('<FormFrame', source.indexOf('const draftBanner')));
            expect(frame.slice(0, frame.indexOf('action={')), name).toMatch(/lead=\{[\s\S]*?draftBanner/);
            expect(source, name).not.toContain('<DraftDiscardButton');
            expect(source, name).not.toMatch(/draftDismissed|dismissDraftNotice/);
            expect(source, name).not.toMatch(/status=\{[\s\S]{0,200}?draftBanner/);
        }
    });
});
