// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The registered dictionaries, shared by i18n/index.js and the English
// namespace files under locales/en/. It imports nothing, so a namespace file
// can register itself without pulling in the formatter and without an import
// cycle through i18n/index.js.

/** @typedef {Record<string, string>} Dictionary */

/** Dictionaries by locale code; English grows as its namespaces load. */
export const DICTIONARIES = /** @type {Record<string, Dictionary>} */ ({ en: {} });

/**
 * Merge one English namespace into the live English dictionary. Each
 * namespace file calls this once, when the first module that renders its
 * keys loads it.
 *
 * @param {Dictionary} messages
 */
export function addEnglish(messages) {
    Object.assign(DICTIONARIES.en, messages);
}
