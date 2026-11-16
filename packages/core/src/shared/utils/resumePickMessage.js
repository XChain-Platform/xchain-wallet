// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const RESUME_PICK_REASONS = Object.freeze([
    'not_resumable',
    'chain_mismatch',
    'source_mismatch',
    'gate_mismatch',
    'file_mismatch',
    'read_failed',
]);

const RESUME_PICK_MESSAGES = Object.freeze({
    not_resumable: 'This upload has ended and cannot be continued.',
    chain_mismatch: 'Switch to the network this upload started on.',
    source_mismatch: 'Continue this upload from the address that started it.',
    gate_mismatch: 'A gated upload continues only from Gated publish. A public one continues only from Publish file or Attach Artwork.',
    file_mismatch: 'Choose the same file you started this upload with.',
    read_failed: 'The picked file could not be read. Choose it again.',
});

export function resumePickMessage(reason) {
    if (typeof reason !== 'string' || !Object.hasOwn(RESUME_PICK_MESSAGES, reason)) return null;
    return { reason, message: RESUME_PICK_MESSAGES[reason] };
}
