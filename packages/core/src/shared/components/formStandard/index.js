// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared building blocks of the Wallet Form Standard. FormSection here
// is the collapsible standard section, not ui/FormSection.jsx.
export { FormFrame } from './FormFrame.jsx';
export { FormSection } from './FormSection.jsx';
export { FromSection } from './FromSection.jsx';
export { FeeSection, feeSummaryParts } from './FeeSection.jsx';
export { FormStatusScope, FormStatusSlot } from './FormStatusSlot.jsx';
export { FormAction } from './FormAction.jsx';
export { useFormSections } from './useFormSections.js';
export { joinSummary, summaryAddress } from './summaryText.js';
