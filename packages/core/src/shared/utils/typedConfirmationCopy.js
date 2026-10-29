// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';

export const typedConfirmationCopy = {
    hint: (word) => t('common.typedConfirmationHint', { word }),
    listShare: () => t('common.typedConfirmationListShareHint'),
    listTransfer: () => t('common.typedConfirmationListTransferHint'),
    listTransferReview: () => t('common.typedConfirmationListTransferReviewHint'),
    oracle: (deviationPct) => t('common.typedConfirmationOracleHint', { deviationPct }),
    sleep: () => t('common.typedConfirmationSleepHint'),
};
