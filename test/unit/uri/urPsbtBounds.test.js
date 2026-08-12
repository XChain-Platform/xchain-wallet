// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UR input bounds (§1, added with the S3 mobile camera lane).
//
// The threat is specific and cheap to mount: the air-gapped lane exists so a
// user can point their camera at a QR code someone handed them. A multi-part
// UR frame declares its own part count, message length and fragment size,
// and the decoder allocates against all three BEFORE anything can be
// authenticated - the checksum only covers the finished message. `seqLen`
// of a hundred million is a well-formed frame that costs one printed page,
// and on a phone the WebView it takes down is the whole wallet.
//
// These tests drive the caps from the outside, the way a scanned frame
// arrives, and assert the decoder refuses rather than allocates.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    UrError,
    UrPsbtDecoder,
    parseUrFrame,
    UR_MAX_SEQ_LEN,
    UR_MAX_FRAME_CHARS,
} from '../../../packages/core/src/uri/urPsbt.js';

const here = dirname(fileURLToPath(import.meta.url));
const { vectors } = JSON.parse(
    readFileSync(join(here, 'fixtures', 'ur-vectors.json'), 'utf8'),
);
const multi = vectors.find((v) => Array.isArray(v.parts) && v.parts.length > 1);

describe('UR sequence-header bounds', () => {
    it('refuses a part count no real PSBT could need', () => {
        // Well-formed in every other respect. Without the cap this line
        // builds a hundred-million-entry array before any payload is looked at.
        expect(() => parseUrFrame('ur:crypto-psbt/1-100000000/aeadaolazmjendeoti'))
            .toThrow(UrError);
        expect(() => parseUrFrame(`ur:crypto-psbt/1-${UR_MAX_SEQ_LEN + 1}/aeadaolazmjendeoti`))
            .toThrow(/exceeds the .* cap/);
    });

    it('still accepts a sequence at the cap', () => {
        // The bound must not be so tight that a legitimate large PSBT
        // becomes unscannable; the cap itself has to parse.
        expect(() => parseUrFrame(`ur:crypto-psbt/1-${UR_MAX_SEQ_LEN}/aeadaolazmjendeoti`))
            .not.toThrow(/exceeds/);
    });

    it('refuses a frame longer than any QR code should carry', () => {
        const huge = `ur:crypto-psbt/${'a'.repeat(UR_MAX_FRAME_CHARS)}`;
        expect(() => parseUrFrame(huge)).toThrow(/over the .* cap/);
    });

    it('keeps rejecting the malformed headers it already rejected', () => {
        // The caps are additions, not replacements: zero and negative part
        // counts were refused before and must stay refused.
        expect(() => parseUrFrame('ur:crypto-psbt/0-3/aeadaolazmjendeoti')).toThrow(UrError);
        expect(() => parseUrFrame('ur:crypto-psbt/1-0/aeadaolazmjendeoti')).toThrow(UrError);
        expect(() => parseUrFrame('ur:crypto-psbt/x-y/aeadaolazmjendeoti')).toThrow(UrError);
    });
});

describe('UR decoding is unchanged for honest input', () => {
    it('still decodes the gold multi-part vector', () => {
        // The whole point of a bound is that it is invisible to real traffic.
        const dec = new UrPsbtDecoder();
        for (const part of multi.parts) {
            dec.receive(part);
            if (dec.complete) break;
        }
        expect(dec.complete).toBe(true);
        expect(dec.psbtHex).toBe(multi.expectedHex);
    });
});
