// Runs every `*.smoke.js` in this directory sequentially and exits
// non-zero on the first failure. Gives `pnpm -C packages/core test:smoke`
// a single command to discover + execute the Node-script smokes
// without hardcoding the list; `pnpm -C packages/core test` runs
// Vitest for everything in `*.test.{js,jsx}`.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const smokes = readdirSync(here)
    .filter((name) => name.endsWith('.smoke.js'))
    .sort();

let failures = 0;
for (const name of smokes) {
    const start = Date.now();
    const result = spawnSync(process.execPath, [join(here, name)], {
        stdio: 'inherit',
        cwd: join(here, '..', '..', '..'),
    });
    const ms = Date.now() - start;
    if (result.status !== 0) {
        failures += 1;
        console.error(`FAIL ${name} (${ms}ms, exit ${result.status})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} / ${smokes.length} smoke(s) failed`);
    process.exit(1);
}
console.log(`\n${smokes.length} smoke(s) passed`);
