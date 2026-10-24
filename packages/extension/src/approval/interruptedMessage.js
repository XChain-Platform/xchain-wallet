// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The plain-language note for an approval whose request was dropped while
// the browser or service worker restarted. Kept in its own module so the
// translation smoke, which treats every dotted literal in a file that calls
// t() as a key, sees only this one.

import { i18n } from '@xchain-wallet/core';
import '@xchain-wallet/core/i18n/locales/en/extension.js';

const { t } = i18n;

export function interruptedApprovalMessage() {
    return t('extension.approval.interrupted');
}
