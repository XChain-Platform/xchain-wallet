// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

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

        const fileButton = screen.getByRole('button', { name: 'Choose backup file' });
        const fileDescription = fileButton.nextElementSibling;
        expect(fileDescription).toHaveTextContent(/Choose or drop a backup file/);

        const contents = screen.getByLabelText('Backup file contents');
        const contentsDescription = document.getElementById('xc-backup-content-description');
        expect(contentsDescription.previousElementSibling).toContainElement(contents);
        expect(contentsDescription).toHaveTextContent(/Paste backup file contents here/);
        expect(contentsDescription.className).toBe(fileDescription.className);
    });
});
