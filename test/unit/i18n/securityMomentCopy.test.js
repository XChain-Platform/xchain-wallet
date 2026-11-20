// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../../packages/core/src/i18n/index.js';
import { privateKeyWarning } from '../../../packages/core/src/shared/utils/securityMomentCopy.js';
import '../../../packages/core/src/i18n/locales/en/settings.js';

describe('security warning dictionary copy', () => {
    beforeEach(async () => setLocale('pseudo-rtl'));
    afterEach(async () => setLocale('en'));

    it('wraps every shared warning as translated copy', () => {
        const recovery = t('common.recoveryPhraseWarning');
        expect(recovery).toContain('⟦Never share your recovery phrase.');
        expect(privateKeyWarning()).toContain('⟦Never share this private key.');
        expect(t('common.contractCallWarning')).toContain('⟦Only approve a contract call you understand.');
    });

    it('inserts the translated recovery warning into translated backup copy', () => {
        const warning = t('common.recoveryPhraseWarning');
        const hint = t('settings.backup.enterYourWalletPasswordMake', { warning });
        expect(hint).toContain('⟦Never share your recovery phrase.');
        expect(hint).toContain('⟦Enter your wallet password.');
    });
});
