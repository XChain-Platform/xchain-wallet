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

// A notice raised from inside a form body (see FormNotice.jsx) is handed up to
// its FormPage, which shows it with the form's other notices at the top of the
// content. That keeps every notice the first item of the page instead of a line
// among the fields. The value is null outside a FormPage, where FormNotice
// renders in place.
//
//   report(id, entry)  show `entry` for notice `id`; pass null to withdraw it
//   entry              { text, variant, role } with text a plain string
export const FormNotices = createContext(
    /** @type {{ report: (id: string, entry: { text: string, variant: string, role?: 'alert' | 'status' | 'note' | null } | null) => void } | null} */ (null),
);
