// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isValidAddressAnyNetwork } from '../shared/utils/addressValidation.js';

export function redactAddresses(text, replacement) {
    const redacted = String(text).replace(/\S+/g, (word) => {
        const leading = word.match(/^[^A-Za-z0-9]*/)[0];
        const trailing = word.match(/[^A-Za-z0-9]*$/)[0];
        const candidate = word.slice(leading.length, word.length - trailing.length);

        return isValidAddressAnyNetwork(candidate)
            ? `${leading}${replacement}${trailing}`
            : word;
    });

    return redacted.replace(/[A-Za-z0-9]{26,}/g, () => replacement);
}
