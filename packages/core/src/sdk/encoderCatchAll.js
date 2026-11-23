// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The text the encoder sends for any fault it has no specific answer for. It
// carries JSON-RPC code -32603 like a transient service failure, but it also
// stands in for deterministic builder faults a retry cannot fix, so it is
// never classified as temporary. The check is on the text because the numeric
// code does not survive messaging between the popup and the background.
export const ENCODER_CATCH_ALL_REASON = /^internal encoder error\.?$/i;
