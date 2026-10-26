// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How long Approve stays inert after a review becomes actionable. Send's submit
// button and Approve sit at the same spot on a phone (the form scrolled to its
// end, the footer pinned to the bottom), so a second tap meant for a slow
// Send button lands on Approve the moment the review swaps in. A deliberate
// Approve comes after the user reads the review, well past this window.
//
// `ms` is a mutable field so the test setup can zero it for suites that click
// Approve the instant the review renders; the settle behaviour has its own
// regression test that restores the production value.
export const APPROVE_SETTLE_MS = 700;
export const approveSettle = { ms: APPROVE_SETTLE_MS };
