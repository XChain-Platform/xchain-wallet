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
// The regular Recovery phrase lane takes BIP39 only. Many BIP39 words are
// also FreeWallet (Counterwallet) words, so a BIP39 phrase with one typo can
// still parse as a FreeWallet phrase; accepting it there would open a
// different, empty wallet instead of telling the user about the typo. That
// lane refuses such a phrase and points FreeWallet users at the From
// FreeWallet lane, which is the only place a FreeWallet phrase is read.

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
 * The format a lane imports `value` as, or null when the lane refuses it.
 * The FreeWallet lane reads a phrase both lists accept as FreeWallet and
 * still takes a BIP39 phrase; the regular lane takes BIP39 only.
 *
 * @param {string} value             normalized phrase
 * @param {boolean} isFreeWalletLane
 * @returns {'bip39' | 'counterwallet' | null}
 */
export function importPhraseFormat(value, isFreeWalletLane = false) {
    if (isFreeWalletLane && isValidCounterwalletMnemonic(value)) return 'counterwallet';
    if (isValidBip39Mnemonic(value)) return 'bip39';
    return null;
}

/**
 * The request fields that pin the format a lane accepted, so no shell
 * re-detects the phrase as the other format. The FreeWallet lane leaves a
 * BIP39 phrase to the flow's own detection, which reads it as BIP39 too.
 *
 * @param {'bip39' | 'counterwallet' | null} format
 * @param {boolean} isFreeWalletLane
 * @returns {{ format?: 'bip39' | 'counterwallet-legacy' }}
 */
export function importPhraseFormatArg(format, isFreeWalletLane = false) {
    if (format === 'counterwallet') return { format: 'counterwallet-legacy' };
    if (format === 'bip39' && !isFreeWalletLane) return { format: 'bip39' };
    return {};
}

/**
 * Why a lane refused `value`, for a phrase `importPhraseFormat` returned
 * null on.
 *
 * @param {string} value             normalized phrase
 * @param {boolean} isFreeWalletLane
 * @returns {string}
 */
export function importPhraseRefusal(value, isFreeWalletLane = false) {
    const words = value.split(' ');
    if (!isFreeWalletLane && isValidCounterwalletMnemonic(value)) {
        return t('importWallet.phrase.notBip39UseFreeWallet');
    }
    const known = isFreeWalletLane
        ? (word) => BIP39_WORDS.has(word) || COUNTERWALLET_WORDS.has(word)
        : (word) => BIP39_WORDS.has(word);
    const unknownWordIndex = words.findIndex((word) => !known(word));
    if (unknownWordIndex !== -1) {
        return `Word ${unknownWordIndex + 1} ("${words[unknownWordIndex]}") is not in the recovery phrase word list. Check its spelling.`;
    }
    if (words.every((word) => BIP39_WORDS.has(word))) {
        return 'Every word is in the BIP39 list, but the checksum does not match. Check the word order and spelling.';
    }
    const nonBip39Word = words.find((word) => !BIP39_WORDS.has(word));
    return `This is not a valid BIP39 or Counterwallet/FreeWallet recovery phrase. Check "${nonBip39Word}" and the other words.`;
}
