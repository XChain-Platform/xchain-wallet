// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared Give/Get standard for Swap, Create order, Dispenser
// and Cross-Chain Swap (Quick and Full views of one form state).
export { useGiveGetView } from './useGiveGetView.js';
export { ViewSwitch } from './ViewSwitch.jsx';
export { GiveGetFull } from './GiveGetFull.jsx';
export { GiveGetQuick, QuickAddressRow } from './GiveGetQuick.jsx';
export { GiveGetSection, GiveGetStaticSection, RateLine } from './GiveGetSection.jsx';
export { OwnershipToggle } from './OwnershipToggle.jsx';
