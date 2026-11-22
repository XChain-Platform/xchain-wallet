// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('extension approval responsive form card', () => {
    const connect = read('packages/core/src/shared/approval/ConnectApproval.jsx');
    const sign = read('packages/core/src/shared/approval/SignApproval.jsx');
    const approvalCss = read('packages/core/src/shared/approval/approval.module.css');
    const formPageCss = read('packages/core/src/ui/FormPage.module.css');

    it('uses FormPage for connect and every shared signing approval body', () => {
        expect(connect).toMatch(/<FormPage as="div"[^>]*>[\s\S]*styles\.siteIdentity[\s\S]*<PickerField[\s\S]*data-connect-permissions[\s\S]*<\/FormPage>/);
        expect(sign).toMatch(/<FormPage as="div" label=\{title\}>[\s\S]*<ConfirmStandard[\s\S]*<\/ConfirmStandard>[\s\S]*<\/FormPage>/);
    });

    it('inherits the 600px FormPage card and centres docked actions to its 560px token', () => {
        expect(formPageCss).toMatch(/@media \(min-width: 600px\)[\s\S]*\.form\s*\{[^}]*max-width:\s*var\(--xc-form-card-max-width\);[^}]*margin:\s*0 auto;[^}]*border:\s*var\(--xc-card-border\)/);
        expect(approvalCss).toMatch(/@media \(min-width: 600px\)\s*\{\s*\.formFooter\s*\{[^}]*max-width:\s*var\(--xc-form-card-max-width\);[^}]*margin-inline:\s*auto;/s);
        expect(connect).toContain('shared.formFooter');
        expect(sign).toContain('shared.formFooter');
        expect(approvalCss.indexOf('.formFooter')).toBeGreaterThan(approvalCss.indexOf('@media (min-width: 600px)'));
    });
});
