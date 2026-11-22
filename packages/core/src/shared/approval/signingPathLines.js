// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The text lines the sign-transaction approval shows for the signing paths a
// dApp scoped its request to. A path is an object (`inputIndex`, an `address`
// or a `derivationPath`, an optional `sighashType`), so joining the array
// directly prints "[object Object]". Every field comes from the page, so each
// goes through the same control-character hardening as the origin line.

import { neutralizeControlText } from '@xchain-wallet/core/shared/utils/textHardening.js';

export function signingPathLines(signingPaths) {
    if (!Array.isArray(signingPaths)) return [];
    return signingPaths.map((entry) => {
        if (typeof entry === 'string') return neutralizeControlText(entry, { maxLength: 200 });
        const target = neutralizeControlText(entry?.address || entry?.derivationPath || '', { maxLength: 200 });
        const index = Number.isInteger(entry?.inputIndex) ? `${entry.inputIndex}: ` : '';
        const sighash = entry?.sighashType === undefined || entry?.sighashType === null
            ? ''
            : ` (sighash ${neutralizeControlText(entry.sighashType, { maxLength: 12 })})`;
        return `${index}${target}${sighash}`.trim();
    }).filter(Boolean);
}
