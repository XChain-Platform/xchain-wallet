#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §3.2: remote-code audit of the BUILT extension bundle.
//
// Manifest V3 bans remotely-hosted code outright and it is the first thing
// a Chrome Web Store reviewer checks on a wallet, so this runs against
// dist/ (what actually ships) rather than src/ (what we meant to ship).
//
// It is a GATE, not a report: three hits are known-benign and allow-listed
// below with the reason; anything else exits non-zero. The allowlist matches
// on a stable code signature rather than a filename, because Vite's chunk
// names carry a content hash that changes on every build.
//
// It also prints every absolute http(s) origin in the shipped text. That
// list is not gated (most entries are inert documentation, licence, and
// demo-fixture strings) but it must be read by a human before submission:
// every host the code can actually contact at runtime has to appear in
// the privacy policy (https://docs.xchain.io/components/wallet/privacy/privacy-policy)
// and match the store's data-disclosure answers, and
// spec §3.3 names that mismatch as a common rejection cause.
//
//   node packages/extension/scripts/remote-code-audit.mjs [distDir]

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// `--help` is answered before anything else, and the reason is specific rather
// than cosmetic: the store ceremony now tells the operator to pass the unpacked
// release artifact as an argument, so this script's argument syntax is
// something they look up mid-submission. Without this, `--help` was read as a
// directory name and answered "no build at --help", which reads as a broken
// build at the moment someone is trying to find out how to point it at the
// right one.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(`Remote-code audit: scan a BUILT extension bundle for code-loading patterns.

Usage:
  node packages/extension/scripts/remote-code-audit.mjs [distDir]

  distDir   directory to audit. Defaults to packages/extension/dist, which is a
            gitignored LOCAL build and is not what the store serves.

For a store submission, audit the artifact being uploaded, not a local build:

  unzip -q -o release-artifacts/vX.Y.Z/xchain-wallet-extension-vX.Y.Z.zip -d /tmp/cws-audit
  node packages/extension/scripts/remote-code-audit.mjs /tmp/cws-audit

Exit codes: 0 clean, 1 unreviewed code-loading pattern found, 2 no build at the
given directory (nothing was audited, which is never an all-clear).`);
    process.exit(0);
}

const DIST = process.argv[2] || 'packages/extension/dist';

if (!existsSync(DIST)) {
    console.error(`remote-code audit: no build at ${DIST}. Run \`pnpm --filter @xchain-wallet/extension build\` first.`);
    process.exit(2);
}

// Each pattern is a way code could be fetched or evaluated at runtime.
// `dynamic-import` deliberately excludes a preceding dot so mathjs's own
// `math.import(...)` method does not read as an ESM dynamic import.
const PATTERNS = [
    ['eval-call', /(^|[^.\w$])eval\s*\(/g],
    ['new-Function', /new\s+Function\s*\(/g],
    ['Function-ctor-call', /(^|[^.\w$])Function\s*\(\s*["'`]/g],
    ['script-element', /createElement\s*\(\s*["'`]script["'`]\s*\)/g],
    ['script-src-remote', /\.src\s*=\s*[^;]{0,80}(https?:|\/\/)/g],
    ['importScripts', /importScripts\s*\(/g],
    // Excludes a preceding dot so mathjs's own `math.import(...)` method is
    // not read as an ESM dynamic import, and a preceding quote so mathjs's
    // `syntax: ["import(functions)"]` documentation strings are not either.
    // A real dynamic import is never immediately preceded by either.
    ['dynamic-import', /(^|[^.\w$"'`])import\s*\(\s*(?!["'`])/g],
    ['import-remote', /\bimport\s*\(\s*["'`]https?:/g],
    ['innerHTML-script', /innerHTML\s*=\s*[^;]{0,60}<script/gi],
    ['wasm-streaming', /WebAssembly\.(instantiateStreaming|compileStreaming)\s*\(/g],
];

// Known-benign, reviewed 2026-07-31. A hit is waived only when its pattern
// AND its surrounding code both match, so an unrelated hit of the same
// pattern still fails the gate.
const ALLOWED = [
    {
        pattern: 'script-element',
        signature: 'chrome.runtime.getURL',
        why: 'contentScript.js injects the packaged provider bundle by extension URL, not a remote one. This is the mechanism the listing pack\'s content-script justification describes.',
    },
    {
        pattern: 'Function-ctor-call',
        signature: 'binder',
        why: 'the bundled `function-bind` shim, reachable only where Function.prototype.bind is missing (never in Chrome) and blocked anyway by MV3\'s default script-src \'self\'. Removable by pruning the dependency.',
    },
    {
        pattern: 'innerHTML-script',
        signature: 'removeChild',
        why: 'React DOM\'s long-standing element-creation workaround. Inert under the MV3 CSP.',
    },
    {
        pattern: 'dynamic-import',
        signature: 'Trailing comma is not allowed',
        why: 'an acorn parser diagnostic string bundled with the contract VM, not a call site.',
    },
    {
        pattern: 'dynamic-import',
        signature: 'nondeterministic across validators',
        why: 'the contract VM\'s determinism-linter message catalogue, which names `import()` in prose to explain why it rejects it. A rule that bans dynamic import, not one that uses it.',
    },
];

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

const files = walk(DIST).filter((f) => ['.js', '.html', '.css', '.json'].includes(extname(f)));
const URL_RE = /https?:\/\/[a-z0-9.@:-]+[a-z0-9](?:[/?#][^\s"'`)\\]*)?/gi;

const waived = [];
const failures = [];
const origins = new Map();

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(DIST, file);

    for (const [name, re] of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            const context = text.slice(Math.max(0, m.index - 120), m.index + 140).replace(/\s+/g, ' ');
            const allow = ALLOWED.find((a) => a.pattern === name && context.includes(a.signature));
            (allow ? waived : failures).push({ file: rel, pattern: name, offset: m.index, context });
        }
    }

    URL_RE.lastIndex = 0;
    let u;
    while ((u = URL_RE.exec(text)) !== null) {
        let origin;
        try { origin = new URL(u[0]).origin; } catch { continue; }
        const rec = origins.get(origin) || { count: 0, files: new Set() };
        rec.count += 1;
        rec.files.add(rel);
        origins.set(origin, rec);
    }
}

console.log(`# Remote-code audit: ${DIST} (${files.length} shipped text files)\n`);

console.log(`## Waived, known-benign (${waived.length})`);
for (const a of ALLOWED) {
    const n = waived.filter((w) => w.pattern === a.pattern).length;
    console.log(`  ${n > 0 ? '·' : '!'} ${a.pattern} x${n}: ${a.why}`);
}
console.log('\n  (a waiver matching 0 hits is not an error: a dependency bump may simply have removed it.)');

console.log(`\n## Absolute http(s) origins in shipped text (${origins.size}), read before submission`);
for (const [origin, rec] of [...origins].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(rec.count).padStart(4)}  ${origin}`);
}

if (failures.length > 0) {
    console.error(`\n## FAIL: ${failures.length} unreviewed code-loading hit(s)`);
    for (const f of failures.slice(0, 20)) {
        console.error(`\n  ${f.pattern}  ${f.file}@${f.offset}`);
        console.error(`    ...${f.context}...`);
    }
    if (failures.length > 20) console.error(`\n  (+${failures.length - 20} more)`);
    console.error('\nEach hit is either a real Manifest V3 remote-code violation, which blocks submission,');
    console.error('or a new benign pattern, which belongs in this script\'s ALLOWED list with its reason.');
    process.exit(1);
}

console.log('\nOK: no unreviewed code-loading pattern in the shipped bundle.');
