// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (name) => readFileSync(resolve('packages/core/src/shared/routes', name), 'utf8');

describe('form submit buttons answer invalid taps', () => {
    it.each([
        ['MintForm.jsx', 'mint-review-password'],
        ['AttachContentForm.jsx', 'attach-content-password'],
        ['PublishFileForm.jsx', 'publish-file-password'],
        ['ProjectRosterForm.jsx', 'project-roster-password'],
    ])('%s reports an empty signing password through the review form', (name, fieldId) => {
        const text = source(name);
        expect(text).toContain('const reviewErrors = useFormErrors();');
        expect(text).toContain(`reviewErrors.validate({ '${fieldId}': 'Enter your wallet password.' });`);
        expect(text).toContain(`passwordFieldId="${fieldId}"`);
        expect(text).toContain('errors={reviewErrors}');
    });

    it('TokenAdminForm reports the typed permanent-lock confirmation', () => {
        const text = source('TokenAdminForm.jsx');
        expect(text).toContain("problems['token-admin-lock-confirm'] = 'Type LOCK to confirm the permanent lock.';");
        expect(text).toContain('id="token-admin-lock-confirm"');
        expect(text).not.toContain('singleEncode && !typedConfirmOk)\n                        || actionConfirm.composing');
    });

    it.each([
        ['DividendForm.jsx', 'errors={formErrors}', 'dividend-amount'],
        ['SleepForm.jsx', 'errors={formErrors}', 'sleep-token'],
        ['AirdropForm.jsx', 'errors={formErrors}', 'airdrop-amount'],
        ['BridgeMoveForm.jsx', 'errors={form}', 'bridge-amount'],
    ])('%s sends field failures to the standard summary', (name, provider, fieldId) => {
        const text = source(name);
        expect(text).toContain(provider);
        expect(text).toContain(`'${fieldId}'`);
    });

    it('TokenDetail reports an empty gated-file password without sending', () => {
        const text = source('TokenDetail.jsx');
        expect(text).toContain("unlockErrors.validate({ 'gated-file-password': 'Enter your wallet password.' });");
        expect(text).toContain('<FormErrorSummary form={unlockErrors} />');
        expect(text).not.toContain('|| password.length === 0\n                                || !Array.isArray(addresses)');
    });
});
