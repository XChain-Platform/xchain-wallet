// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings values needed before a route loads. Keep this leaf module free of
// validators and defaults so the lock screen and shell policies do not pull
// the complete persisted-settings schema into the startup bundle.

export const NETWORK_DEFAULT = 'mainnet';

export const CLIPBOARD_AUTO_CLEAR_MAX = 600;
export const CLIPBOARD_AUTO_CLEAR_DEFAULT = 60;

export const AUTOLOCK_NEVER = 0;
export const AUTOLOCK_MINUTES_MIN = 1;
export const AUTOLOCK_MINUTES_MAX = 1440;
export const AUTOLOCK_MINUTES_DEFAULT = 15;
