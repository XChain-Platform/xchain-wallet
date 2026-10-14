// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createContext } from 'react';

/**
 * The current route key, provided around the layout's notices slot so a
 * notice can close its own disclosures when the user navigates.
 */
export const NoticesRouteContext = createContext(/** @type {string | null} */ (null));
