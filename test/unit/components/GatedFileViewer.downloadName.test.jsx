// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import {
    GatedFileViewer,
    safeDownloadName,
} from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';

beforeAll(() => {
    URL.createObjectURL = vi.fn(() => 'blob:name-test');
    URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('GatedFileViewer download name', () => {
    it.each([
        ['../../etc/passwd', 'etc_passwd'],
        ['a\\b/c.txt', 'a_b_c.txt'],
        ['bad\u0000name\r\n.txt', 'bad_name_.txt'],
        ['report‮gnp.exe', 'report_gnp.exe'],
        ['.hidden', 'hidden'],
        ['trailing. ', 'trailing'],
        ['', 'unlocked-file'],
        ['///', 'unlocked-file'],
    ])('cleans %j to %j', (input, expected) => {
        expect(safeDownloadName(input)).toBe(expected);
    });

    it('limits the length', () => {
        expect(safeDownloadName('a'.repeat(500)).length).toBe(120);
    });

    it('hands the browser only the cleaned name', () => {
        let seen = null;
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
            seen = this.download;
        });
        render(
            <GatedFileViewer
                name="../../evil\\name.txt"
                declaredType="text/plain"
                plaintextBase64={Buffer.from('hello').toString('base64')}
                onClose={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        expect(seen).toBe('evil_name.txt');
        click.mockRestore();
    });
});
