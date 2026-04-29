// §24.6 / G057 smoke — desktop multi-window support.
//
// Asserts (static-source level — Electron isn't booted in smokes):
//   1. packages/desktop/main/index.js no longer holds a singleton
//      `mainWindow`; instead a `windows` Set tracks every open
//      BrowserWindow, and `liveWindows()` filters out destroyed ones.
//   2. `createWindow()` factory replaces `createMainWindow`. Each call
//      registers itself with the `windows` Set and unregisters on
//      `closed`. Show on `ready-to-show`.
//   3. `buildApplicationMenu()` wires `File → New Window` with
//      CmdOrCtrl+N → `createWindow()` so the user can open additional
//      windows without restarting the app.
//   4. Deep-link forwarder targets the focused window (or last-created
//      fallback) instead of a singleton; updater events broadcast to
//      every live window.
//   5. `app.activate` (macOS dock click) calls `createWindow()` when no
//      windows exist, matching the §24.6 single/multi-window contract.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const mainPath = join(wsRoot, 'packages', 'desktop', 'main', 'index.js');
assert.ok(existsSync(mainPath), 'packages/desktop/main/index.js exists');

const src = readFileSync(mainPath, 'utf8');

// --- 1. windows Set replaces singleton ----------------------------------

assert.ok(/const windows = .*new Set\(\)/.test(src),
    'windows Set tracks every open BrowserWindow');
assert.ok(/function liveWindows\(\)\s*\{[\s\S]*?\.filter\(\(w\)\s*=>\s*!w\.isDestroyed\(\)\)/.test(src),
    'liveWindows() filters out destroyed windows');
assert.ok(!/^let mainWindow\b/m.test(src),
    'no top-level singleton mainWindow remains');

// --- 2. createWindow factory --------------------------------------------

assert.ok(/function createWindow\(\)\s*\{[\s\S]*?new BrowserWindow/.test(src),
    'createWindow() factory creates fresh BrowserWindow instances');
assert.ok(/windows\.add\(win\)/.test(src),
    'createWindow registers the new window with the windows Set');
assert.ok(/win\.on\('closed',\s*\(\)\s*=>\s*\{\s*windows\.delete\(win\)/.test(src),
    'window unregisters from the Set on closed');
assert.ok(/win\.once\('ready-to-show',[\s\S]*?win\.show\(\)/.test(src),
    'each window shows itself on ready-to-show');
assert.ok(/return win;/.test(src),
    'createWindow returns the new window so callers can pin behaviour');

// --- 3. Application menu with File → New Window -------------------------

assert.ok(/function buildApplicationMenu\(\)/.test(src),
    'buildApplicationMenu() exists');
assert.ok(/Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(template\)\)/.test(src),
    'application menu is installed from the template');
assert.ok(/label:\s*'New Window'[\s\S]*?accelerator:\s*'CmdOrCtrl\+N'[\s\S]*?createWindow\(\)/.test(src),
    'File → New Window (Cmd/Ctrl+N) calls createWindow()');
// macOS-aware app-name submenu shape.
assert.ok(/process\.platform === 'darwin'/.test(src),
    'menu template branches on macOS for the app-name submenu');

// --- 4. Deep-link + updater multi-window routing ------------------------

assert.ok(/function pickFocusWindow\(\)/.test(src),
    'pickFocusWindow() picks the focused (or last-created) window');
assert.ok(/BrowserWindow\.getFocusedWindow\(\)\s*\|\|\s*live\[live\.length - 1\]/.test(src),
    'pickFocusWindow falls back to the most-recently-created live window');
assert.ok(/function forwardDeepLink\(event\)\s*\{[\s\S]*?pickFocusWindow\(\)/.test(src),
    'forwardDeepLink targets the focused window');
assert.ok(/function broadcastToWindows\(channel,\s*payload\)/.test(src),
    'broadcastToWindows() helper iterates every live window');
assert.ok(/onEvent:\s*\(event\)\s*=>\s*\{\s*broadcastToWindows\('xchain:updater',\s*event\)/.test(src),
    'updater events broadcast to every live window via broadcastToWindows');

// --- 5. activate hook + first-window bootstrap --------------------------

assert.ok(/buildApplicationMenu\(\);\s*\n\s*createWindow\(\);/.test(src),
    'whenReady installs the menu, then opens the primary window');
assert.ok(/app\.on\('activate',\s*\(\)\s*=>\s*\{\s*if \(BrowserWindow\.getAllWindows\(\)\.length === 0\) createWindow\(\)/.test(src),
    'app.activate (dock click on macOS) creates a window when none exist');

console.log(
    'OK — desktop-multi-window smoke (§24.6 / G057 windows Set replaces singleton mainWindow; createWindow factory + register-on-add / unregister-on-closed; File → New Window menu (Cmd/Ctrl+N) calls createWindow; deep-link forwarder + updater event multiplex over live windows; activate-hook reopens when none remain)',
);
