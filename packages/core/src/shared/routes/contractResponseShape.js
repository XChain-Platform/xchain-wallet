// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer's single-record endpoints answer in a few historical shapes
// ({data: row}, {data: [row]}, [row], or the bare row). Normalize to the row
// so callers don't re-implement the unwrap. Shared by ContractDetail and
// ExecuteContractForm.
export function extractSingle(resp) {
    if (!resp) return null;
    if (resp.data && !Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.data) && resp.data.length > 0) return resp.data[0];
    if (Array.isArray(resp) && resp.length > 0) return resp[0];
    return resp;
}
