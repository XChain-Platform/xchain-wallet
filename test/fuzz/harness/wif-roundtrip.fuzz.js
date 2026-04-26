// Fuzz: WIF round-trip property — decode(encode(privkey, ver, comp))
// recovers (privkey, ver, comp) for any valid input.

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { encodeWif, decodeWif } from '../../../packages/core/src/crypto/wif.js';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 100);

describe('fuzz/wif/round-trip', () => {
    it('encode → decode is identity', () => {
        fc.assert(
            fc.property(
                fc.uint8Array({ minLength: 32, maxLength: 32 }),
                fc.integer({ min: 0, max: 255 }),
                fc.boolean(),
                (privkey, ver, compressed) => {
                    const w = encodeWif(privkey, ver, compressed);
                    const got = decodeWif(w);
                    return got.versionByte === ver
                        && got.compressed === compressed
                        && Buffer.from(got.privateKey).toString('hex')
                            === Buffer.from(privkey).toString('hex');
                },
            ),
            { numRuns: RUNS },
        );
    });
});
