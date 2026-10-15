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

// A control deep in a form (the fee selector) that has something to say hands
// the text up to its FormPage, which shows it with the form's other notices at
// the top of the content. That keeps every notice the first item of the page
// instead of a line under the field that raised it. The value is null outside
// a FormPage, where the control keeps its own inline notice.
//
//   report(id, text)  show `text` for control `id`; pass null to withdraw it
export const FormNotices = createContext(
    /** @type {{ report: (id: string, text: string | null) => void } | null} */ (null),
);
