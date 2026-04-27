// Smoke for §37.2 / G119 — ToastHost + useToast + integration into
// ContactsList delete and History "Clear filters" + App.jsx wrapping.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const components = join(core, 'src', 'shared', 'components');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. ToastHost.jsx + .module.css exist + the named exports -------------

const thPath = join(components, 'ToastHost.jsx');
const thCss = join(components, 'ToastHost.module.css');
assert.ok(existsSync(thPath), 'ToastHost.jsx exists');
assert.ok(existsSync(thCss), 'ToastHost.module.css exists');

const th = readFileSync(thPath, 'utf8');
assert.ok(/export function ToastHost\b/.test(th), 'ToastHost is a named export');
assert.ok(/export function useToast\b/.test(th), 'useToast is a named export');
for (const field of ['showToast', 'dismissToast', 'clearToasts']) {
    assert.ok(
        new RegExp(`\\b${field}\\b`).test(th),
        `useToast API exposes ${field}`,
    );
}
// Auto-dismiss timer is the spec's "after the timeout, the action is
// final" contract — ToastHost has to clean its timers up on unmount.
assert.ok(/clearTimeout/.test(th), 'ToastHost clears its setTimeout timers');
// Default 8s per §37.2.
assert.ok(/8000/.test(th), 'ToastHost defaults durationMs to 8000 per §37.2');

// --- 2. CSS includes the reduced-motion guard + viewport positioning -----

const thCssSrc = readFileSync(thCss, 'utf8');
assert.ok(
    /@media \(prefers-reduced-motion: reduce\)/.test(thCssSrc),
    'ToastHost CSS guards animation under prefers-reduced-motion',
);
assert.ok(/position:\s*fixed/.test(thCssSrc),
    'ToastHost viewport is position: fixed');
assert.ok(/pointer-events:\s*none/.test(thCssSrc),
    'ToastHost viewport sets pointer-events: none so it never traps clicks');

// --- 3. ContactsList delete shows an Undo toast --------------------------

const cl = readFileSync(join(routes, 'ContactsList.jsx'), 'utf8');
assert.ok(/from\s*['"]\.\.\/components\/ToastHost\.jsx['"]/.test(cl)
    || /from\s*['"]\.\.\/components\/ToastHost\.jsx['"]/.test(cl),
    'ContactsList imports useToast from ToastHost');
assert.ok(/useToast\(\)/.test(cl),
    'ContactsList instantiates the useToast hook');
assert.ok(/showToast\(/.test(cl),
    'ContactsList shows a toast after delete');
assert.ok(/actionLabel:\s*['"]Undo['"]/.test(cl),
    'ContactsList toast labels its action "Undo"');
assert.ok(/saveContact/.test(cl),
    'ContactsList undo path re-saves the contact');

// --- 4. History "Clear filters" emits an Undo toast ----------------------

const hist = readFileSync(join(routes, 'History.jsx'), 'utf8');
assert.ok(/useToast\b/.test(hist),
    'History imports / uses the useToast hook');
assert.ok(/showToast\(/.test(hist),
    'History.clearAllFilters shows a toast');

// --- 5. Both shells wrap their unlocked tree in <ToastHost> -------------

for (const appPath of [
    join(web, 'src', 'App.jsx'),
    join(ext, 'src', 'popup', 'App.jsx'),
]) {
    const src = readFileSync(appPath, 'utf8');
    assert.ok(
        /from '@xchain-wallet\/core\/shared\/components\/ToastHost\.jsx'/.test(src),
        `${appPath} imports ToastHost`,
    );
    assert.ok(/<ToastHost\b/.test(src),
        `${appPath} wraps its tree in <ToastHost>`);
}

console.log('toast-host smoke OK');
