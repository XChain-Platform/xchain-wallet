// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lock address signs on the legacy review, with no pre-flight between the
// typed LOCK and the signature. A locked address cannot create any XChain
// action until it wakes, a new lock included, so the indexer refuses a second
// lock after the fee is spent. An unread or malformed state refuses as well:
// nothing later on that path would catch an address that is already locked.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/routes.js';

/**
 * Why an address cannot be locked now, or null when it can.
 *
 * @param {'loading' | 'ready' | 'failed'} read   state of the address's SLEEP read
 * @param {{ resumeBlock: number | null } | null} row  latest address SLEEP, null when none
 * @param {number | null} height                   indexed height, null when unknown
 * @returns {string | null}
 */
export function addressLockStateError(read, row, height) {
    if (read === 'loading') return t('routes.sleepForm.lockStatePending');
    if (read !== 'ready') return t('routes.sleepForm.lockStateUnread');
    const resumeBlock = row ? row.resumeBlock : null;
    if (resumeBlock == null || resumeBlock === 0) return null;
    if (resumeBlock === -1) return t('routes.sleepForm.addressLockedForGood');
    if (!Number.isSafeInteger(resumeBlock) || resumeBlock < 0) return t('routes.sleepForm.lockStateUnread');
    // A wake block needs the height to judge; Review and signing refresh it.
    if (!Number.isSafeInteger(height)) return null;
    return resumeBlock > height
        ? t('routes.sleepForm.addressLockedUntil', { resumeBlock: resumeBlock.toLocaleString('en-US') })
        : null;
}
