// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon } from '@xchain-wallet/core/ui';

// The leading icon of each lock row names the thing being locked. The switch
// beside it already says locked or unlocked, so no row draws a lock or
// unlock glyph. One table serves the Issue form and the token Lock form.
const LOCK_ICON_BY_FIELD = {
    LOCK_MAX_SUPPLY: Icon.MaxIcon,
    LOCK_MAX_MINT: Icon.TargetIcon,
    LOCK_MINT: Icon.MintIcon,
    LOCK_MINT_SUPPLY: Icon.CoinsIcon,
    LOCK_DESCRIPTION: Icon.DocumentIcon,
    LOCK_SLEEP: Icon.PauseIcon,
    LOCK_CALLBACK: Icon.ZapIcon,
};

/** @param {string} field a LOCK_FLAGS field, e.g. LOCK_MINT */
export function lockIconFor(field) {
    return LOCK_ICON_BY_FIELD[field] || Icon.TokenIcon;
}
