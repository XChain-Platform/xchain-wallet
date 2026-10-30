// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A browser remembers a module URL whose dynamic import failed, so importing
// the same chunk again after the network returns fails the same way. Only a
// page reload loads it afresh.
const CHUNK_LOAD_FAILURE = /dynamically imported module|importing a module script failed|loading chunk .* failed|error loading dynamically/i;

/**
 * True when `error` is a failed fetch of a lazily loaded route chunk.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isChunkLoadError(error) {
    if (!error || typeof error !== 'object') return false;
    if (error.name === 'ChunkLoadError') return true;
    return CHUNK_LOAD_FAILURE.test(String(error.message ?? ''));
}
