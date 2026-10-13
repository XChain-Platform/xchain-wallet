import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Two lanes edited the popup shell in parallel: one replaced a ref with the
// launch-route state, the other kept writing to the old ref. The merge left
// `pendingUriView.current = ...` with no declaration, which throws as soon as
// a payment link opens the popup. Every ref a shell writes must be declared.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHELLS = [
    'packages/extension/src/popup/App.jsx',
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
];

describe('shell ref declarations', () => {
    for (const rel of SHELLS) {
        it(`${rel} declares every ref it writes`, () => {
            const source = readFileSync(join(root, rel), 'utf8');
            const written = new Set([...source.matchAll(/\b([A-Za-z_$][\w$]*)\.current\s*=(?!=)/g)].map((m) => m[1]));
            const undeclared = [...written].filter((name) => !new RegExp(
                `(?:const|let|var)\\s+${name}\\s*=|[{,]\\s*${name}\\s*[,}]|\\(\\s*\\{[^)]*\\b${name}\\b`,
            ).test(source));
            expect(undeclared).toEqual([]);
        });
    }
});
