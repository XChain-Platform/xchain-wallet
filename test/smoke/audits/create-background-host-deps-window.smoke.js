// The createBackgroundHost deps destructure grows with every new dependency,
// so smokes must locate it by anchors instead of a fixed-size character window.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');

const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const factoryStart = hostSrc.indexOf('export function createBackgroundHost');
const depsStart = hostSrc.indexOf('const {', factoryStart);
const depsEnd = hostSrc.indexOf('} = deps', depsStart);
assert.ok(factoryStart >= 0 && depsStart > factoryStart && depsEnd > depsStart,
    'the deps destructure is locatable by its anchors');
const destructure = hostSrc.slice(depsStart, depsEnd);
assert.ok(destructure.includes('...hostDeps'), 'the destructure ends in the hostDeps rest element');
assert.ok(destructure.includes('bridgeEvents,'), 'the destructure names bridgeEvents');
assert.ok(destructure.includes('getDiagnosticContext,'), 'the destructure names getDiagnosticContext');

const fixedWindow = /createBackgroundHost[^\n]*\)?\s*\[\\s\\S\]\{\d+(,\d+)?\}/;
for (const rel of [
    ['test', 'smoke', 'bridge', 'bridge-events-emit.smoke.js'],
    ['test', 'smoke', 'audits', 'diagnostic-dump-shell-context.smoke.js'],
]) {
    const src = read(...rel);
    assert.ok(!fixedWindow.test(src), `${rel.at(-1)} has no fixed-size regex window over the deps destructure`);
    assert.ok(!/hostSrc\.slice\([^)]*\+\s*\d{3,}\)/.test(src) && !/createSrc\.slice\([^)]*\+\s*\d{3,}\)/.test(src),
        `${rel.at(-1)} has no fixed-length slice over createBackgroundHost`);
}

console.log('create-background-host-deps-window: ok');
