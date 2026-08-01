// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UR (Uniform Resources) crypto-psbt decoder (§20.4 / G043, Cluster U FU 2).
//
// UR is the animated-QR PSBT transport used by Foundation Passport and
// Keystone. A frame looks like:
//
//   single part:  ur:crypto-psbt/<bytewords>
//   multi  part:  ur:crypto-psbt/<seqNum>-<seqLen>/<bytewords>
//
// The codec is three layers, all reimplemented here clean-room from the
// Blockchain Commons specs (no third-party UR dependency):
//
//   1. Bytewords (BCR-2020-012, "minimal" style): every byte maps to a
//      4-letter word; minimal encoding keeps only the first + last letter
//      (2 chars/byte). The decoded stream is `data || CRC32(data)` (the
//      4-byte big-endian checksum is appended), which we verify and strip.
//   2. CBOR (BCR-2020-006): crypto-psbt wraps the raw PSBT in a single
//      CBOR byte-string. Multi-part frames instead carry the fountain
//      part as a 5-element CBOR array (see below).
//   3. Fountain / Luby-transform reassembly (BCR-2020-005): multi-part
//      frames are rateless-coded so a scanner can recover the message
//      from any sufficient subset of frames. Each part is
//      `[seqNum, seqLen, messageLen, checksum, fragment]`; parts with
//      `seqNum > seqLen` are XOR mixes of several source fragments,
//      chosen by a seeded Xoshiro256** RNG + alias-sampled degree +
//      Fisher-Yates shuffle. The decoder reduces mixed parts against
//      known fragments until every source fragment is recovered.
//
// Public surface mirrors bbqrPsbt.js: a stateful `UrPsbtDecoder` for
// progressive scanning, plus a `decodeUrPsbt(frames)` batch convenience.

import { sha256 } from '@noble/hashes/sha2';
import { crc32 } from './psbtQr.js';

export const UR_PREFIX = 'ur:';
export const UR_PSBT_TYPE = 'crypto-psbt';

// Input bounds ( §1, S3: the mobile camera lane).
//
// EVERY NUMBER BELOW ARRIVES FROM A QR CODE SOMEONE ELSE PRINTED. That is
// the whole point of the air-gapped lane: the user points a camera at a
// screen or a piece of paper they were handed. A multi-part frame declares
// its own `seqLen`, `messageLength` and fragment size, and the decoder
// allocates against all three before a single byte has been authenticated -
// there is no checksum to check until the message is whole. A frame reading
// `seqLen = 100000000` is well-formed UR and costs one photograph to
// present; unbounded, it takes the WebView down, and on the mobile shells
// the WebView is the wallet.
//
// The bounds are set well above any legitimate PSBT and far below anything
// that hurts: a 100 KB PSBT (a very large multisig spend) at the ~200-byte
// fragments hardware signers emit is a few hundred parts, so 4096 leaves
// room to spare while capping the index array at something trivial. The
// fragment cap keeps one part from carrying the DoS on its own.
export const UR_MAX_SEQ_LEN = 4096;
export const UR_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const UR_MAX_FRAGMENT_BYTES = 64 * 1024;
export const UR_MAX_FRAME_CHARS = 8 * 1024;

export class UrError extends Error {
    constructor(msg) {
        super(`ur: ${msg}`);
        this.name = 'UrError';
    }
}

// --- Bytewords (minimal style) ----------------------------------------------

// The canonical 256-word list (BCR-2020-012), each word exactly 4 letters,
// concatenated. The minimal code for a byte is `word[0] + word[3]`.
const BYTEWORDS =
    'ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybrag' +
    'brewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdata' +
    'daysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexit' +
    'eyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegear' +
    'gemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholy' +
    'hopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugs' +
    'jumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliar' +
    'limplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmiss' +
    'monknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeck' +
    'playpluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofruby' +
    'ruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxi' +
    'tenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovial' +
    'vibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawn' +
    'yellyogayurtzapszerozestzinczonezoom';

// Reverse map: 2-char minimal code -> byte value. Built once.
const MINIMAL_TO_BYTE = (() => {
    /** @type {Record<string, number>} */
    const map = Object.create(null);
    for (let i = 0; i < 256; i++) {
        const w = BYTEWORDS.slice(i * 4, i * 4 + 4);
        map[w[0] + w[3]] = i;
    }
    return map;
})();

/**
 * Decode a minimal-style bytewords string into its data bytes, verifying
 * and stripping the trailing 4-byte CRC32.
 *
 * @param {string} text   minimal bytewords (2 chars per encoded byte)
 * @returns {Uint8Array}  the data with the checksum removed
 */
export function decodeBytewordsMinimal(text) {
    if (typeof text !== 'string') throw new UrError('bytewords must be a string');
    const clean = text.trim().toLowerCase();
    if (clean.length === 0) throw new UrError('empty bytewords');
    if (clean.length % 2 !== 0) {
        throw new UrError(`bytewords length must be even (got ${clean.length})`);
    }
    const all = new Uint8Array(clean.length / 2);
    for (let i = 0; i < all.length; i++) {
        const code = clean[i * 2] + clean[i * 2 + 1];
        const b = MINIMAL_TO_BYTE[code];
        if (b === undefined) throw new UrError(`invalid byteword "${code}"`);
        all[i] = b;
    }
    if (all.length < 5) {
        throw new UrError(`bytewords too short to carry a checksum (${all.length} bytes)`);
    }
    const dataLen = all.length - 4;
    const data = all.subarray(0, dataLen);
    const want = crc32(data) >>> 0;
    const got =
        ((all[dataLen] << 24) | (all[dataLen + 1] << 16) | (all[dataLen + 2] << 8) | all[dataLen + 3]) >>> 0;
    if (want !== got) {
        throw new UrError('bytewords checksum mismatch');
    }
    // Copy out so callers own a standalone buffer (subarray shares storage).
    return data.slice();
}

// --- Minimal CBOR reader (uint / byte-string / array only) ------------------

/**
 * Read one CBOR item starting at `offset`. Supports the subset UR needs:
 * unsigned ints (major 0), byte strings (major 2), arrays (major 4). Returns
 * the decoded value plus the offset just past it.
 *
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {{ value: any, next: number }}
 */
function cborRead(bytes, offset) {
    if (offset >= bytes.length) throw new UrError('cbor: unexpected end of input');
    const ib = bytes[offset];
    const major = ib >> 5;
    const minor = ib & 0x1f;
    let off = offset + 1;

    const readUint = (n) => {
        if (off + n > bytes.length) throw new UrError('cbor: truncated integer');
        let v = 0;
        for (let i = 0; i < n; i++) v = v * 256 + bytes[off + i];
        off += n;
        return v;
    };

    let len;
    if (minor < 24) len = minor;
    else if (minor === 24) len = readUint(1);
    else if (minor === 25) len = readUint(2);
    else if (minor === 26) len = readUint(4);
    else if (minor === 27) len = readUint(8);
    else throw new UrError(`cbor: unsupported additional-info ${minor}`);

    if (major === 0) {
        return { value: len, next: off };
    }
    if (major === 2) {
        if (off + len > bytes.length) throw new UrError('cbor: truncated byte string');
        const value = bytes.slice(off, off + len);
        return { value, next: off + len };
    }
    if (major === 4) {
        const arr = [];
        for (let i = 0; i < len; i++) {
            const r = cborRead(bytes, off);
            arr.push(r.value);
            off = r.next;
        }
        return { value: arr, next: off };
    }
    throw new UrError(`cbor: unsupported major type ${major}`);
}

/**
 * Decode a CBOR byte-string into its raw bytes. crypto-psbt wraps the PSBT
 * this way, so this is the final unwrap before returning the PSBT.
 *
 * @param {Uint8Array} message
 * @returns {Uint8Array}
 */
export function cborUnwrapBytes(message) {
    const { value } = cborRead(message, 0);
    if (!(value instanceof Uint8Array)) {
        throw new UrError('cbor: expected a byte string');
    }
    return value;
}

// --- Xoshiro256** seeded RNG (BCR-2020-005) ---------------------------------

const MASK64 = (1n << 64n) - 1n;

function rotl64(x, k) {
    const kk = BigInt(k);
    return ((x << kk) | (x >> (64n - kk))) & MASK64;
}

class Xoshiro {
    /** @param {Uint8Array} seed */
    constructor(seed) {
        const digest = sha256(seed); // 32 bytes -> four big-endian uint64 words
        this.s = [0n, 0n, 0n, 0n];
        for (let i = 0; i < 4; i++) {
            let v = 0n;
            for (let n = 0; n < 8; n++) {
                v = ((v << 8n) | BigInt(digest[i * 8 + n])) & MASK64;
            }
            this.s[i] = v;
        }
    }

    roll() {
        const s = this.s;
        const result = (rotl64((s[1] * 5n) & MASK64, 7) * 9n) & MASK64;
        const t = (s[1] << 17n) & MASK64;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = rotl64(s[3], 45);
        s[2] &= MASK64;
        s[3] &= MASK64;
        s[1] &= MASK64;
        s[0] &= MASK64;
        return result;
    }

    nextDouble() {
        // roll() / 2^64, matching the reference's BigNumber division.
        return Number(this.roll()) / 18446744073709551616;
    }

    nextInt(low, high) {
        return Math.floor(this.nextDouble() * (high - low + 1) + low);
    }
}

// --- Degree chooser (Walker alias method) + Fisher-Yates shuffle ------------

/**
 * Walker alias-method sampler, matching @keystonehq/alias-sampling exactly:
 * the small/large stacks are filled by scanning indexes high-to-low, and a
 * draw consumes two rng() values (bin select + alias coin-flip). Reproducing
 * the construction order is required so the same RNG stream yields the same
 * degree as the reference encoder.
 *
 * @param {number[]} probabilities  unnormalized weights
 * @param {() => number} rng        returns [0,1)
 * @returns {() => number}          draws an outcome index
 */
function makeAliasSampler(probabilities, rng) {
    const n = probabilities.length;
    const sum = probabilities.reduce((a, p) => a + p, 0);
    const scaled = probabilities.map((p) => (p * n) / sum);
    const prob = new Array(n);
    const alias = new Array(n);
    const small = [];
    const large = [];
    for (let i = n - 1; i >= 0; i--) {
        if (scaled[i] < 1) small.push(i);
        else large.push(i);
    }
    while (small.length > 0 && large.length > 0) {
        const less = small.pop();
        const more = large.pop();
        prob[less] = scaled[less];
        alias[less] = more;
        scaled[more] = scaled[more] + scaled[less] - 1;
        if (scaled[more] < 1) small.push(more);
        else large.push(more);
    }
    while (large.length > 0) prob[large.pop()] = 1;
    while (small.length > 0) prob[small.pop()] = 1;
    return () => {
        const c = Math.floor(rng() * prob.length);
        return rng() < prob[c] ? c : alias[c];
    };
}

/**
 * Choose the fountain degree for a mixed part: weights are 1/(i+1) over
 * 0..seqLen-1, alias-sampled; degree = chosen index + 1.
 *
 * @param {number} seqLen
 * @param {Xoshiro} rng
 * @returns {number}
 */
function chooseDegree(seqLen, rng) {
    const weights = [];
    for (let i = 0; i < seqLen; i++) weights.push(1 / (i + 1));
    const draw = makeAliasSampler(weights, () => rng.nextDouble());
    return draw() + 1;
}

/**
 * Fisher-Yates shuffle, draining a copy by repeatedly removing a random index
 * (matches the reference's splice-based shuffle so RNG consumption lines up).
 *
 * @param {number[]} items
 * @param {Xoshiro} rng
 * @returns {number[]}
 */
function shuffle(items, rng) {
    const remaining = items.slice();
    const result = [];
    while (remaining.length > 0) {
        const index = rng.nextInt(0, remaining.length - 1);
        result.push(remaining[index]);
        remaining.splice(index, 1);
    }
    return result;
}

/**
 * Which source-fragment indexes a part mixes. Parts with seqNum <= seqLen are
 * "pure" (the single fragment seqNum-1); higher seqNums are RNG-chosen mixes.
 *
 * @param {number} seqNum
 * @param {number} seqLen
 * @param {number} checksum   CRC32 of the whole message (uint32)
 * @returns {number[]}        fragment indexes, ascending-ish (set semantics)
 */
export function chooseFragments(seqNum, seqLen, checksum) {
    if (seqNum <= seqLen) return [seqNum - 1];
    const seed = new Uint8Array(8);
    const dv = new DataView(seed.buffer);
    dv.setUint32(0, seqNum >>> 0, false);
    dv.setUint32(4, checksum >>> 0, false);
    const rng = new Xoshiro(seed);
    const degree = chooseDegree(seqLen, rng);
    const indexes = [];
    for (let i = 0; i < seqLen; i++) indexes.push(i);
    const shuffled = shuffle(indexes, rng);
    return shuffled.slice(0, degree);
}

// --- Fountain decoder -------------------------------------------------------

function arraysEqualSet(a, b) {
    if (a.length !== b.length) return false;
    return a.every((x) => b.includes(x));
}
function contains(outer, inner) {
    return inner.every((x) => outer.includes(x));
}
function setDifference(a, b) {
    return a.filter((x) => !b.includes(x));
}
function xorInto(a, b) {
    const len = Math.max(a.length, b.length);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = (a[i] || 0) ^ (b[i] || 0);
    return out;
}

/**
 * Stateful fountain reassembler. Feed it `{ indexes, fragment }` parts; it
 * reduces mixed parts against recovered fragments until the whole message is
 * known. Mirrors the reference reduce/queue algorithm.
 */
class FountainAssembler {
    constructor() {
        this.expectedIndexes = null; // null until first part seen
        this.messageLength = 0;
        this.checksum = 0;
        this.fragmentLength = 0;
        this.received = []; // recovered source-fragment indexes
        this.simple = []; // { indexes:[i], fragment }
        this.mixed = []; // { indexes, fragment }
        this.queue = [];
        this.result = null;
    }

    /** @returns {boolean} true once the full message is recovered */
    get complete() {
        return this.result !== null;
    }

    _validate(part) {
        if (this.expectedIndexes === null) {
            // The first part dictates every allocation that follows, and it
            // is the least trustworthy input in the system: nothing has been
            // authenticated yet (the checksum only covers the assembled
            // message). Bound it here, before the index array is built.
            if (part.seqLen > UR_MAX_SEQ_LEN) {
                throw new UrError(
                    `fountain part declares ${part.seqLen} parts, over the ${UR_MAX_SEQ_LEN} cap`,
                );
            }
            if (part.messageLength > UR_MAX_MESSAGE_BYTES) {
                throw new UrError(
                    `fountain message declares ${part.messageLength} bytes, over the cap`,
                );
            }
            if (part.fragment.length > UR_MAX_FRAGMENT_BYTES) {
                throw new UrError('fountain fragment is larger than the cap');
            }
            // A message cannot be shorter than nothing or longer than the
            // parts that carry it; either would make the final slice a lie.
            if (part.messageLength < 1 || part.messageLength > part.seqLen * part.fragment.length) {
                throw new UrError('fountain message length is inconsistent with its parts');
            }
            this.expectedIndexes = [];
            for (let i = 0; i < part.seqLen; i++) this.expectedIndexes.push(i);
            this.messageLength = part.messageLength;
            this.checksum = part.checksum;
            this.fragmentLength = part.fragment.length;
            return true;
        }
        return (
            this.expectedIndexes.length === part.seqLen &&
            this.messageLength === part.messageLength &&
            this.checksum === part.checksum &&
            this.fragmentLength === part.fragment.length
        );
    }

    _reduce(a, b) {
        if (contains(a.indexes, b.indexes) && !arraysEqualSet(a.indexes, b.indexes)) {
            return { indexes: setDifference(a.indexes, b.indexes), fragment: xorInto(a.fragment, b.fragment) };
        }
        return a;
    }

    _reduceMixedBy(part) {
        const next = [];
        for (const m of this.mixed) {
            const r = this._reduce(m, part);
            if (r.indexes.length === 1) this.queue.push(r);
            else next.push(r);
        }
        this.mixed = next;
    }

    _processSimple(part) {
        const idx = part.indexes[0];
        if (this.received.includes(idx)) return;
        this.simple.push(part);
        this.received.push(idx);
        if (arraysEqualSet(this.received, this.expectedIndexes)) {
            const sorted = this.simple.slice().sort((a, b) => a.indexes[0] - b.indexes[0]);
            const joined = new Uint8Array(sorted.length * this.fragmentLength);
            sorted.forEach((p, i) => joined.set(p.fragment, i * this.fragmentLength));
            const message = joined.slice(0, this.messageLength);
            if ((crc32(message) >>> 0) === (this.checksum >>> 0)) {
                this.result = message;
            } else {
                throw new UrError('fountain message checksum mismatch');
            }
        } else {
            this._reduceMixedBy(part);
        }
    }

    _processMixed(part) {
        if (this.mixed.some((m) => arraysEqualSet(m.indexes, part.indexes))) return;
        let p = part;
        for (const s of this.simple) p = this._reduce(p, s);
        for (const m of this.mixed) p = this._reduce(p, m);
        if (p.indexes.length === 1) {
            this.queue.push(p);
        } else {
            this._reduceMixedBy(p);
            this.mixed.push(p);
        }
    }

    /**
     * @param {{ seqNum:number, seqLen:number, messageLength:number, checksum:number, fragment:Uint8Array }} part
     * @returns {boolean} whether the part was accepted (valid + not after completion)
     */
    receive(part) {
        if (this.complete) return false;
        if (!this._validate(part)) return false;
        const indexes = chooseFragments(part.seqNum, part.seqLen, part.checksum);
        this.queue.push({ indexes, fragment: part.fragment });
        while (!this.complete && this.queue.length > 0) {
            const item = this.queue.shift();
            if (item.indexes.length === 1) this._processSimple(item);
            else this._processMixed(item);
        }
        return true;
    }
}

// --- Frame parsing ----------------------------------------------------------

/**
 * @typedef {Object} UrFrame
 * @property {string} type          UR type, e.g. "crypto-psbt"
 * @property {boolean} isSinglePart true when the frame has no seq segment
 * @property {number} seqNum        1-based sequence number (1 for single-part)
 * @property {number} seqLen        total pure fragments (1 for single-part)
 * @property {Uint8Array} cbor      bytewords-decoded payload (message or part)
 */

/**
 * Parse one `ur:...` frame into its type, sequence header, and decoded
 * payload bytes. Does NOT interpret the CBOR; callers decide message vs part.
 *
 * @param {string} frame
 * @returns {UrFrame}
 */
export function parseUrFrame(frame) {
    if (typeof frame !== 'string') throw new UrError('frame must be a string');
    // Bound before decoding: bytewords expansion allocates proportionally to
    // this string, and a QR code can carry far more than any real UR frame.
    if (frame.length > UR_MAX_FRAME_CHARS) {
        throw new UrError(`frame is ${frame.length} chars, over the ${UR_MAX_FRAME_CHARS} cap`);
    }
    const trimmed = frame.trim().toLowerCase();
    if (!trimmed.startsWith(UR_PREFIX)) throw new UrError('frame does not start with "ur:"');
    const rest = trimmed.slice(UR_PREFIX.length);
    const segments = rest.split('/');
    if (segments.length < 2) throw new UrError('frame missing payload');
    const type = segments[0];
    if (!/^[a-z0-9-]+$/.test(type)) throw new UrError(`invalid UR type "${type}"`);

    if (segments.length === 2) {
        // ur:<type>/<bytewords>
        return { type, isSinglePart: true, seqNum: 1, seqLen: 1, cbor: decodeBytewordsMinimal(segments[1]) };
    }
    // ur:<type>/<seqNum>-<seqLen>/<bytewords>
    const seq = segments[1];
    const body = segments[2];
    const m = /^(\d+)-(\d+)$/.exec(seq);
    if (!m) throw new UrError(`malformed sequence segment "${seq}"`);
    const seqNum = Number(m[1]);
    const seqLen = Number(m[2]);
    if (!Number.isInteger(seqNum) || !Number.isInteger(seqLen) || seqNum < 1 || seqLen < 1) {
        throw new UrError(`bad sequence ${seqNum}-${seqLen}`);
    }
    if (seqLen > UR_MAX_SEQ_LEN) {
        throw new UrError(`sequence length ${seqLen} exceeds the ${UR_MAX_SEQ_LEN}-part cap`);
    }
    return { type, isSinglePart: false, seqNum, seqLen, cbor: decodeBytewordsMinimal(body) };
}

/** Decode a multi-part frame's CBOR into the fountain part structure. */
function decodePartCbor(cbor) {
    const { value } = cborRead(cbor, 0);
    if (!Array.isArray(value) || value.length !== 5) {
        throw new UrError('fountain part must be a 5-element CBOR array');
    }
    const [seqNum, seqLen, messageLength, checksum, fragment] = value;
    if (
        typeof seqNum !== 'number' ||
        typeof seqLen !== 'number' ||
        typeof messageLength !== 'number' ||
        typeof checksum !== 'number' ||
        !(fragment instanceof Uint8Array) ||
        fragment.length === 0
    ) {
        throw new UrError('fountain part has the wrong field types');
    }
    return { seqNum, seqLen, messageLength, checksum, fragment };
}

// --- Public decoder ---------------------------------------------------------

/**
 * Progressive UR PSBT decoder. Feed frames as a scanner reads them; check
 * `progress` / `complete` and read `psbt` once done. Single-part frames
 * complete on the first `receive`.
 */
export class UrPsbtDecoder {
    /** @param {{ expectType?: string }} [opts] */
    constructor(opts = {}) {
        this.expectType = opts.expectType ?? UR_PSBT_TYPE;
        this._assembler = null;
        this._message = null; // recovered message CBOR (before unwrap)
        this._type = null;
    }

    /** @returns {boolean} */
    get complete() {
        return this._message !== null;
    }

    /**
     * Fraction of expected pure fragments recovered (0..1). 1 once complete.
     * Single-part frames jump straight to 1.
     * @returns {number}
     */
    get progress() {
        if (this.complete) return 1;
        if (!this._assembler || !this._assembler.expectedIndexes) return 0;
        const total = this._assembler.expectedIndexes.length;
        return total === 0 ? 0 : this._assembler.received.length / total;
    }

    /**
     * Feed one frame. Frames of a different UR type, or after completion, are
     * ignored (returns false). Malformed frames throw UrError.
     *
     * @param {string} frame
     * @returns {boolean} whether the frame advanced decoding
     */
    receive(frame) {
        if (this.complete) return false;
        const parsed = parseUrFrame(frame);
        if (this._type === null) this._type = parsed.type;
        if (parsed.type !== this._type) return false;
        if (this.expectType && parsed.type !== this.expectType) {
            throw new UrError(`expected UR type "${this.expectType}", got "${parsed.type}"`);
        }

        if (parsed.isSinglePart) {
            this._message = parsed.cbor;
            return true;
        }
        if (!this._assembler) this._assembler = new FountainAssembler();
        const part = decodePartCbor(parsed.cbor);
        const accepted = this._assembler.receive(part);
        if (this._assembler.complete) this._message = this._assembler.result;
        return accepted;
    }

    /** @returns {Uint8Array} the decoded raw PSBT bytes (throws if incomplete) */
    get psbt() {
        if (!this.complete) throw new UrError('decode incomplete: more frames needed');
        return cborUnwrapBytes(this._message);
    }

    /** @returns {string} the decoded PSBT as lowercase hex */
    get psbtHex() {
        return bytesToHex(this.psbt);
    }
}

/**
 * Batch convenience: decode a complete set of UR frames into the PSBT. Throws
 * if the frames are insufficient to reassemble the message.
 *
 * @param {string[]} frames
 * @returns {{ psbt: Uint8Array, psbtHex: string }}
 */
export function decodeUrPsbt(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new UrError('frames must be a non-empty array');
    }
    const dec = new UrPsbtDecoder();
    for (const f of frames) {
        dec.receive(f);
        if (dec.complete) break;
    }
    if (!dec.complete) {
        throw new UrError(`decode incomplete after ${frames.length} frames; need more`);
    }
    return { psbt: dec.psbt, psbtHex: dec.psbtHex };
}

function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}
