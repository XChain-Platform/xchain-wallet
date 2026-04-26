// Bench: KDF (Argon2id) at floor params + at a 2x param tier.
// KDF dominates unlock latency; if a refactor doubles its time the
// user feels it on every reload.

import { deriveMasterKey, KDF_MIN_MEMORY_KIB, KDF_MIN_ITERATIONS } from '../../../packages/core/src/crypto/kdf.js';

const PWD = 'correct horse battery staple';
const FLOOR = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: KDF_MIN_ITERATIONS,
    memory: KDF_MIN_MEMORY_KIB,
    parallelism: 1,
};

export async function runScenario(run) {
    return [
        await run('kdf-floor', () => { deriveMasterKey(PWD, FLOOR); }, 5),
        await run('kdf-2x-iterations', () => {
            deriveMasterKey(PWD, { ...FLOOR, iterations: KDF_MIN_ITERATIONS * 2 });
        }, 3),
        await run('kdf-2x-memory', () => {
            deriveMasterKey(PWD, { ...FLOOR, memory: KDF_MIN_MEMORY_KIB * 2 });
        }, 3),
    ];
}
