// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/watch.js';
import { nativePlatformName } from '../nativeShell.js';

export function MobileAutopayNotice() {
    const platform = nativePlatformName();
    if (platform !== 'ios' && platform !== 'android') return null;

    return (
        <StatusMessage variant="info" testId="mobile-autopay-notice">
            {t('watch.mobileAutopayNotice')}
        </StatusMessage>
    );
}
