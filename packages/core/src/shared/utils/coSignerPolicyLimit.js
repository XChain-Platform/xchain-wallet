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
import '../../i18n/locales/en/coSigner.js';

/**
 * Words for an agent account policy field left unset, which is unrestricted;
 * null when the field carries a value to show exactly.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function policyNoLimitText(value) {
    return value == null ? t('coSigner.provision.noLimit') : null;
}
