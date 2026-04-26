// Fuzz: BIP39 mnemonic ↔ entropy round-trip is identity for any
// 16/20/24/28/32-byte entropy.

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
    entropyToBip39Mnemonic,
    bip39MnemonicToEntropy,
    isValidBip39Mnemonic,
} from '../../../packages/core/src/crypto/mnemonic.js';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 100);

describe('fuzz/mnemonic/round-trip', () => {
    it('entropy → mnemonic → entropy is identity', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(16, 20, 24, 28, 32),
                fc.uint8Array({ minLength: 32, maxLength: 32 }),
                (length, srcRaw) => {
                    const ent = srcRaw.slice(0, length);
                    const m = entropyToBip39Mnemonic(ent);
                    if (!isValidBip39Mnemonic(m)) return false;
                    const back = bip39MnemonicToEntropy(m);
                    return Buffer.from(back).toString('hex')
                        === Buffer.from(ent).toString('hex');
                },
            ),
            { numRuns: RUNS },
        );
    });
});
