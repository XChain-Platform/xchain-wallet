// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which recovery-phrase format each import lane accepts, and what it says
// when a phrase is refused.
//
// The BIP39 wallet type takes BIP39 only. FreeWallet / PartyWallet uses the
// shared legacy Counterwallet word list and checksum. Keeping those choices
// strict prevents a typo in one format from opening a different, empty wallet.

import { englishWordlist, isValidBip39Mnemonic } from '../../crypto/mnemonic.js';
import {
    COUNTERWALLET_WORDLIST,
    isValidCounterwalletMnemonic,
} from '../../crypto/counterwallet.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/importWallet.js';

const BIP39_WORDS = new Set(englishWordlist);
const COUNTERWALLET_WORDS = new Set(COUNTERWALLET_WORDLIST);

/**
 * The format a wallet type imports `value` as, or null when it refuses it.
 *
 * @param {string} value             normalized phrase
 * @param {boolean} legacyType
 * @returns {'bip39' | 'counterwallet' | null}
 */
export function importPhraseFormat(value, legacyType = false) {
    if (legacyType) {
        return isValidCounterwalletMnemonic(value) ? 'counterwallet' : null;
    }
    if (isValidBip39Mnemonic(value)) return 'bip39';
    return null;
}

/**
 * The request fields that pin the format a lane accepted, so no shell
 * re-detects the phrase as the other format.
 *
 * @param {'bip39' | 'counterwallet' | null} format
 * @returns {{ format?: 'bip39' | 'counterwallet-legacy' }}
 */
export function importPhraseFormatArg(format) {
    if (format === 'counterwallet') return { format: 'counterwallet-legacy' };
    if (format === 'bip39') return { format: 'bip39' };
    return {};
}

/**
 * Why a lane refused `value`, for a phrase `importPhraseFormat` returned
 * null on.
 *
 * @param {string} value             normalized phrase
 * @param {boolean} legacyType
 * @returns {string}
 */
export function importPhraseRefusal(value, legacyType = false) {
    const words = value.split(' ');
    if (!legacyType && isValidCounterwalletMnemonic(value)) {
        return t('importWallet.phrase.notBip39UseLegacy');
    }
    const known = legacyType
        ? (word) => COUNTERWALLET_WORDS.has(word)
        : (word) => BIP39_WORDS.has(word);
    const unknownWordIndex = words.findIndex((word) => !known(word));
    if (unknownWordIndex !== -1) {
        const listName = legacyType ? 'Counterwallet/FreeWallet' : 'BIP39';
        return `Word ${unknownWordIndex + 1} ("${words[unknownWordIndex]}") is not in the ${listName} word list. Check its spelling.`;
    }
    if (!legacyType && words.every((word) => BIP39_WORDS.has(word))) {
        return 'Every word is in the BIP39 list, but the checksum does not match. Check the word order and spelling.';
    }
    if (legacyType) {
        return 'Every word is in the Counterwallet/FreeWallet list, but the phrase check does not match. Check the word order and spelling.';
    }
    const nonBip39Word = words.find((word) => !BIP39_WORDS.has(word));
    return `This is not a valid BIP39 recovery phrase. Check "${nonBip39Word}" and the other words.`;
}
