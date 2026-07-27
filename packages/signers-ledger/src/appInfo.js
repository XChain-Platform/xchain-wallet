// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reads the app name + version from a Ledger device.
//
// This exists because `@ledgerhq/hw-app-btc` does NOT expose
// `getAppAndVersion` as a method on its `Btc` class, only as a
// standalone helper taking a transport. Every call site here used to
// call `app.getAppAndVersion()`, which is `undefined` on the real
// class, so the whole Ledger lane threw `TypeError` on first contact
// with hardware . Verified against Speculos running Bitcoin
// app 2.5.0: `typeof app.getAppAndVersion === 'undefined'`.
//
// The device call is BOLOS `GET_APP_AND_VERSION` (CLA 0xB0, INS 0x01),
// which every Ledger app answers regardless of vendor SDK version, so
// this stays a one-APDU read rather than a vendor import. Keeping it
// vendor-free is deliberate: this package declares no `@ledgerhq`
// dependency (§9 / G002), the shells own those imports.

/**
 * @typedef {Object} LedgerAppInfo
 * @property {string} name      Open app's name, e.g. 'Bitcoin' or 'Bitcoin Test'
 * @property {string} version   Semver string reported by the app, e.g. '2.5.0'
 * @property {Uint8Array} flags Raw BOLOS app flags
 */

/**
 * Read the currently-open app's name and version.
 *
 * @param {{ send: (cla: number, ins: number, p1: number, p2: number) => Promise<Uint8Array> }} transport
 * @returns {Promise<LedgerAppInfo>}
 */
export async function readLedgerAppInfo(transport) {
    if (!transport || typeof transport.send !== 'function') {
        throw new Error('readLedgerAppInfo: a Ledger transport is required');
    }
    const r = await transport.send(0xb0, 0x01, 0x00, 0x00);

    // Response is TLV: format byte, then length-prefixed name, version
    // and flags. Format 1 is the only one BOLOS has ever emitted; a
    // different value means we are not talking to a Ledger app and
    // guessing at the layout would return a plausible wrong name.
    let i = 0;
    const format = r[i++];
    if (format !== 1) {
        throw new Error(`readLedgerAppInfo: unsupported response format ${format}`);
    }
    const nameLength = r[i++];
    const name = bytesToAscii(r.slice(i, (i += nameLength)));
    const versionLength = r[i++];
    const version = bytesToAscii(r.slice(i, (i += versionLength)));
    const flagLength = r[i++];
    const flags = r.slice(i, (i += flagLength));

    return { name, version, flags };
}

function bytesToAscii(bytes) {
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
}
