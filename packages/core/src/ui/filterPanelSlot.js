// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext } from 'react';

// True inside a list page's filter panel (ListFilterMenu). Dropdowns there
// show no visible label: the label becomes the control's accessible name and
// the first option names the filter ("All networks"), so every list page's
// panel reads the same without each page dropping its own labels.
export const InFilterPanel = createContext(false);
