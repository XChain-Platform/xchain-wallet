// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

afterEach(cleanup);

describe('ImportWallet backup field descriptions', () => {
    it('places both descriptions immediately after their fields with one gap class', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));

        const fileButton = screen.getByRole('button', { name: 'Choose Backup File' });
        const fileDescription = fileButton.nextElementSibling;
        expect(fileDescription).toHaveTextContent(/Choose or drop a backup file/);

        const contents = screen.getByLabelText('Backup file contents');
        const contentsDescription = document.getElementById('xc-backup-content-description');
        expect(contentsDescription.previousElementSibling).toContainElement(contents);
        expect(contentsDescription).toHaveTextContent(/Paste backup file contents here/);
        expect(contentsDescription.className).toBe(fileDescription.className);
        expect(fileDescription.parentElement).toBe(fileButton.parentElement);
    });

    it('sets each description the shared help gap under its field, as the password hints sit', () => {
        const css = readFileSync('packages/core/src/shared/routes/ImportWallet.module.css', 'utf8');
        const inputCss = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        const wrapper = css.match(/\n\.fieldWithDescription\s*\{([^}]*)\}/)?.[1] || '';
        expect(wrapper).toMatch(/flex-direction:\s*column/);
        expect(wrapper).toMatch(/gap:\s*var\(--xc-help-gap\)/);
        // Inside the wrapper the description adds no margin of its own, so
        // the gap is the whole space, the same help gap a field hint takes.
        expect(css).toMatch(/\.fieldWithDescription \.fieldDescription\s*\{[^}]*margin-top:\s*0/);
        expect(inputCss).toMatch(/\n\.hint\s*\{[^}]*margin-block-start:\s*var\(--xc-help-gap\)/);
        expect(wrapper).not.toMatch(/padding|margin/);
    });
});
