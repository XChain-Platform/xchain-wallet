// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whether 64 hex characters name an Ed25519 public key that can sign.
//
// The indexer checks a delegated key's format only, so a DELEGATE to any 64
// hex characters indexes valid and the fee is spent. A value that is not a
// point on the curve can never produce a signature, and a small-order point
// (the identity among them) is a key whose signatures anyone can forge, so the
// stake would sign with nothing or with everyone. Both are refused before a
// delegation to them is composed or signed.

import { ed25519 } from '@noble/curves/ed25519';

export const UNUSABLE_SIGNING_KEY_MESSAGE = 'This is not a usable Ed25519 public key. Check the key and try again.';

/**
 * @param {unknown} hex  64 hex characters, either case
 * @returns {string | null}  the refusal to show, or null for a usable key
 */
export function signingKeyRefusal(hex) {
    const value = typeof hex === 'string' ? hex.trim() : '';
    if (!/^[0-9a-fA-F]{64}$/.test(value)) return UNUSABLE_SIGNING_KEY_MESSAGE;
    let point;
    try {
        point = ed25519.ExtendedPoint.fromHex(value.toLowerCase());
    } catch {
        return UNUSABLE_SIGNING_KEY_MESSAGE;
    }
    return point.isSmallOrder() ? UNUSABLE_SIGNING_KEY_MESSAGE : null;
}
