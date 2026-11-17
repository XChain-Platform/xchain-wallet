// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An address inside a one-line summary ("Bitcoin, bc1q…7c1c", "0.5 BTC to
// bc1q…0a2", "To bc1q…clex"). G99: the address shows whole when the line has
// room and is cut in the middle only as much as the line needs, so it is the
// kit's fitting AddressText in the summary's own colour and size, never a
// fixed four-and-four string.

import { Fragment } from 'react';
import { AddressText } from '../../../ui/AddressText.jsx';
import styles from './formStandard.module.css';

/**
 * @param {object} props
 * @param {string | null | undefined} props.address
 */
export function SummaryAddress({ address }) {
    const text = typeof address === 'string' ? address.trim() : '';
    if (!text) return null;
    return <AddressText address={text} size="sm" className={styles.summaryAddress} />;
}

/**
 * A translated line with an address in it: `t(key, { name: address })` with
 * the address drawn as a SummaryAddress where the placeholder sits.
 *
 * @param {(key: string, vars: object) => string} t
 * @param {string} key
 * @param {string} name   the placeholder's name ("address", "delegate")
 * @param {string} address
 * @returns {import('react').ReactNode}
 */
export function summaryLineWithAddress(t, key, name, address) {
    const mark = '\u0000';
    const line = String(t(key, { [name]: mark }));
    const at = line.indexOf(mark);
    if (at === -1) return line;
    return (
        <>
            {line.slice(0, at)}
            <SummaryAddress address={address} />
            {line.slice(at + mark.length)}
        </>
    );
}

/**
 * Joins the non-empty parts of a summary, strings or nodes, with `separator`.
 * All strings give a string, exactly as joinSummary does; any node gives a
 * fragment list.
 *
 * @param {Array<import('react').ReactNode>} parts
 * @param {string} [separator]
 * @returns {import('react').ReactNode}
 */
export function joinSummaryParts(parts, separator = ', ') {
    const kept = parts.filter((part) => (
        typeof part === 'string' ? part.trim() !== '' : part !== null && part !== undefined && part !== false
    ));
    if (kept.every((part) => typeof part === 'string')) return kept.join(separator);
    // The parts are positional and fixed per render, so their index is their key.
    return kept.map((part, i) => <Fragment key={i}>{i > 0 ? separator : null}{part}</Fragment>);
}
