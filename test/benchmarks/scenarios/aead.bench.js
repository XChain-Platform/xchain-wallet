// Bench scenario: AEAD throughput at typical wallet payload sizes.

import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';

export async function runScenario(run) {
    const KEY = new Uint8Array(32).fill(1);
    const sizes = [{ label: '1KB', n: 200, bytes: 1024 },
                   { label: '10KB', n: 50, bytes: 10240 },
                   { label: '1MB', n: 5, bytes: 1 << 20 }];
    const out = [];
    for (const s of sizes) {
        const buf = new Uint8Array(s.bytes);
        out.push(await run(`encrypt-${s.label}`, async () => {
            await encrypt(KEY, buf);
        }, s.n));
        const ct = await encrypt(KEY, buf);
        out.push(await run(`decrypt-${s.label}`, async () => {
            await decrypt(KEY, ct);
        }, s.n));
    }
    return out;
}
