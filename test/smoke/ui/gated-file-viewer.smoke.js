// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-27 (gated unlock viewer hardening): unlocked gated
// plaintext is attacker-controlled, so TokenDetail must never open it
// as a document (the old `window.open(blobUrl)` executed declared
// text/html or image/svg+xml bytes in the wallet origin). Render
// decisions come from byte sniffing, inline surfaces are script-inert
// (img / pre), downloads are typed octet-stream, and the holder key
// cache is vault-backed (unlock persists recovered keys; a vaulted
// key unlocks without a password).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
// The threat-model comments legitimately NAME the banned sinks; the
// no-sink assertions must only see executable lines.
const stripComments = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ---- TokenDetail: no document-context sinks for gated bytes -------------
const detail = read('packages', 'core', 'src', 'shared', 'routes', 'TokenDetail.jsx');
const detailCode = stripComments(detail);
assert.doesNotMatch(detailCode, /window\.open/, 'TokenDetail never window.opens gated plaintext');
assert.doesNotMatch(detailCode, /createObjectURL/, 'TokenDetail builds no blob URLs itself (viewer owns them)');
assert.match(detail, /import \{ GatedFileViewer \} from '\.\.\/components\/GatedFileViewer\.jsx'/,
    'TokenDetail routes unlocked bytes into the sandboxed viewer');
assert.match(detail, /<GatedFileViewer/, 'viewer modal is rendered');
assert.match(detail, /declaredType: file\.type \|\| null/,
    'declared type is passed as a label, not a render decision');

// ---- Viewer: sniffed bytes, script-inert surfaces only ------------------
const viewer = read('packages', 'core', 'src', 'shared', 'components', 'GatedFileViewer.jsx');
const viewerCode = stripComments(viewer);
assert.match(viewer, /import \{ sniffContent \} from '\.\.\/utils\/sniffContent\.js'/,
    'viewer classifies by sniffing bytes');
assert.doesNotMatch(viewerCode, /window\.open/, 'viewer never opens documents');
assert.doesNotMatch(viewerCode, /dangerouslySetInnerHTML/, 'viewer never injects markup');
assert.doesNotMatch(viewerCode, /<iframe|<object|<embed/, 'no plugin/document containers');
assert.match(viewer, /sniffed\.kind !== 'image' && sniffed\.kind !== 'svg'/,
    'blob URL exists only for img-renderable kinds');
assert.match(viewer, /<img className=\{styles\.image\} src=\{imageUrl\}/,
    'images (incl. SVG) render via <img> - the script-inert context');
assert.match(viewer, /<pre className=\{styles\.text\}>\{text\}<\/pre>/,
    'text renders as an escaped React text node');
assert.match(viewer, /type: 'application\/octet-stream'/,
    'downloads are typed octet-stream regardless of sniffed type');
assert.match(viewer, /declaredMatchesSniff/, 'declared-vs-sniffed mismatch warning wired');

// ---- Sniffer: bytes in, no declared-type parameter ----------------------
const sniff = read('packages', 'core', 'src', 'shared', 'utils', 'sniffContent.js');
assert.match(sniff, /export function sniffContent\(bytes\)/, 'sniff takes bytes only');
assert.match(sniff, /image\/svg\+xml/, 'SVG detected as its own kind');
assert.match(sniff, /TextDecoder\('utf-8', \{ fatal: true \}\)/, 'strict UTF-8 gate for text');
assert.match(sniff, /kind === 'image' \|\| kind === 'svg' \|\| kind === 'text'/,
    'inline allowlist is exactly image/svg/text');

// ---- Vault-backed holder key cache --------------------------------------
const flow = read('packages', 'core', 'src', 'flows', 'gatedContent.js');
assert.match(flow, /if \(walletId && gateTicker && chainId && vault\.gatedKeys\) \{/,
    'unlock resolves the vault key cache first');
assert.match(flow, /source: 'recovered',\n\s+\}\)\);\n\s+\}\n\s+\}\n\s+\} catch \(_e\) \{/,
    'scan-recovered keys persist to the vault (best-effort)');
const detailVault = detail.includes("messaging.listGatedKeys({ walletId, chainId, gateTicker: tick })");
assert.ok(detailVault, 'TokenDetail probes vaulted keys to skip the password prompt');
assert.match(detail, /gateTicker: tick,\n\s+chainId,/,
    'password-path unlocks pass gateTicker so the host can persist the key');
