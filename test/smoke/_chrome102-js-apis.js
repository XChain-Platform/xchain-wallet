// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const CHROME_102_UNSUPPORTED_INSTANCE_APIS = [
    'toSorted',
    'toReversed',
    'toSpliced',
    'with',
    'union',
    'intersection',
    'difference',
    'symmetricDifference',
    'isSubsetOf',
    'isSupersetOf',
    'isDisjointFrom',
    'isWellFormed',
];

export const CHROME_102_UNSUPPORTED_STATIC_APIS = [
    'Object.groupBy',
    'Map.groupBy',
    'Promise.withResolvers',
    'Array.fromAsync',
];

const instanceAlternation = CHROME_102_UNSUPPORTED_INSTANCE_APIS.join('|');
const staticAlternation = CHROME_102_UNSUPPORTED_STATIC_APIS
    .map((name) => name.replace('.', '[.]'))
    .join('|');

export const CHROME_102_UNSUPPORTED_API_GREP = [
    `[.](${instanceAlternation})[[:space:]]*[(]`,
    `(^|[^[:alnum:]_$])(${staticAlternation})[[:space:]]*[(]`,
].join('|');

export const CHROME_102_UNSUPPORTED_API_REGEX = new RegExp([
    `[.](${instanceAlternation})[ \\t]*[(]`,
    `(?:^|[^\\w$])(${staticAlternation})[ \\t]*[(]`,
].join('|'), 'gm');
