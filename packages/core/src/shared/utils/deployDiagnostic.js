// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Rewrites the contract-deploy diagnostics that name SDK internals into copy a
// contract author can act on, for DeployContractForm's validate / plan /
// suggest-gas surfaces.
//
// The line this draws, and why it is narrow. Most of what reaches the deploy
// form is LINTER output from xchain-sdk/src/contract/lint-core.js, and that
// linter is written for exactly this reader: every message carries the line
// number, the offending symbol, and the prescribed fix ("Use xchain.math.pow()
// instead", "Default it (e.g. `|| '0'`) or require() it first"). Translating
// those would delete the only actionable part, so they pass through untouched.
//
// What does NOT pass through is text naming an implementation identifier the
// author has no way to act on: the SDK constant MAX_DEPLOY_CHUNKS, the byte cap
// stated as a bare number, the parser's ES-version rejection, the WebAssembly
// ban stated in terms of __gas metering, and suggestGasLimit's rationale, which
// is a raw heuristic dump rather than authored copy.
//
// The two WARNING-severity advisories are here for a second reason, and it is
// the reason this file exists at all. `warnings` is the only diagnostic array
// DeployContractForm renders on the res.valid === true branch, so it is the
// surface finding #4374 is anchored on; every error-severity rule above is
// unreachable from there. Both advisories state their consequence as "the gas
// ceiling", an internal the author cannot see or set, so they are rewritten in
// terms of what the author does control: the deploy running out of gas.
//
// Every rewrite is LOSSLESS: each one carries forward every number and
// identifier the raw string held, so there is nothing left to keep in an
// "advanced detail" and the form does not need a disclosure widget to stay
// honest. A string no rule matches is returned unchanged, so an SDK rephrasing
// degrades to today's behavior rather than to a wrong translation.
//
// `userFacingMessage` is the sibling FILTER (swap developer output for a
// fallback) and `humanizeError` classifies node/SDK failures into recovery
// causes. Neither knows contract-deploy vocabulary, and neither should: this
// one owns it.

/**
 * Pluralize a count for advisory copy.
 *
 * @param {number|string} n
 * @param {string} word
 * @returns {string}
 */
function plural(n, word) {
    return `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
}

// One entry per SDK string that names an internal the author cannot act on.
// `test` is anchored on the emitting expression, so a rephrasing upstream stops
// matching (and falls through to raw) rather than mistranslating.
const RULES = [
    {
        // xchain-sdk/src/chunkHelper.js: 'Contract source needs N chunks,
        // exceeds MAX_DEPLOY_CHUNKS (M)'.
        rule: 'deploy-chunk-overflow',
        test: /needs\s+(\d+)\s+chunks?,\s*exceeds\s+MAX_DEPLOY_CHUNKS\s*\((\d+)\)/i,
        copy: (m) => `This contract is too large to deploy: it would take ${m[1]} parts and a deploy may use at most ${m[2]}. Remove unused code or split it into smaller contracts.`,
    },
    {
        // xchain-sdk/src/contracts.js validate(): 'Contract code exceeds N byte
        // limit (M bytes)'. This guard returns BEFORE lintSource runs, so it,
        // not lint-core's own 'code-size' rule, is the string this caller can
        // ever see; the lint-core wording is matched below only as a fallback
        // in case that source order is ever reversed.
        rule: 'code-size',
        test: /Contract code exceeds\s*(\d+)\s*byte limit\s*\((\d+)\s*bytes\)/i,
        copy: (m) => `This contract is ${m[2]} bytes, over the ${m[1]}-byte deploy limit. Remove unused code, then check the size again.`,
    },
    {
        rule: 'code-size',
        test: /code size exceeds limit\s*\((\d+)\s*bytes\)/i,
        copy: (m) => `This contract is over the ${m[1]}-byte deploy limit. Remove unused code, then check the size again.`,
    },
    {
        // lint-core rule 'unsupported-syntax': 'unsupported syntax (ESxxxx
        // maximum): <parser message>'.
        rule: 'unsupported-syntax',
        test: /unsupported syntax\s*\(ES(\d+) maximum\):\s*(.+)$/i,
        copy: (m) => `Contracts must use ES${m[1]} JavaScript or older, and this source uses something newer. The parser stopped at: ${m[2]}`,
    },
    {
        // lint-core rule 'reserved-identifier': 'reserved identifier: <name>'.
        // The identifier IS the fix, so it is kept verbatim in the copy.
        rule: 'reserved-identifier',
        test: /^reserved identifier:\s*(\S+)/i,
        copy: (m) => `The name \`${m[1]}\` is reserved by the contract runtime and cannot appear in contract source. Rename it, then validate again.`,
    },
    {
        // lint-core rule 'banned-wasm', whose raw text explains itself in terms
        // of __gas metering and consensus forks.
        rule: 'banned-wasm',
        test: /banned global:\s*WebAssembly at line\s*(\d+)/i,
        copy: (m) => `WebAssembly is not available to contracts (line ${m[1]}). The sandbox removes it, so that code cannot run and its cost cannot be measured. Rewrite that section in plain JavaScript.`,
    },
    {
        // lint-core rule 'unbounded-loop' (severity warning): 'unbounded loop at
        // line N; termination depends entirely on an internal break (the gas
        // ceiling will halt it otherwise)'. Reachable at the warnings render.
        rule: 'unbounded-loop',
        test: /unbounded loop at line\s*(\d+);\s*termination depends entirely on an internal break/i,
        copy: (m) => `The loop at line ${m[1]} has no exit condition, so it ends only if code inside it breaks out. If nothing does, it keeps running until the deploy runs out of gas and the transaction fails.`,
    },
    {
        // lint-core rule 'large-allocation' (severity warning): 'bulk allocation
        // (<what>) at line N; gas-metered at runtime, keep the size bounded so
        // it cannot hit the gas ceiling'. The allocation kind IS the fix, so it
        // is kept verbatim. Reachable at the warnings render.
        rule: 'large-allocation',
        test: /bulk allocation\s*\(([^)]+)\)\s*at line\s*(\d+);\s*gas-metered at runtime/i,
        copy: (m) => `The bulk allocation \`${m[1]}\` at line ${m[2]} is charged for by its size while the contract runs. Keep that size bounded, or a large input can use up all the gas and fail the transaction.`,
    },
];

// xchain-sdk/src/contracts.js suggestGasLimit(): a fixed-shape count dump, not
// authored copy. Parsed rather than pattern-matched so every count survives.
const RATIONALE = /^(\d+) bytes, (\d+) functions, (\d+) loops \((\d+) indexed for, charged 2x\/iteration\), (\d+) emit calls, (\d+) state ops$/;

/**
 * Translate one deploy diagnostic. Returns the input unchanged when no rule
 * matches, so unrecognized text keeps today's behavior.
 *
 * @param {unknown} input   an Error, a string, or anything
 * @returns {{ message: string, matched: boolean, rule: (string|null) }}
 */
export function humanizeDeployDiagnostic(input) {
    const raw = (input && typeof input === 'object')
        ? (/** @type {any} */ (input).message || '')
        : (typeof input === 'string' ? input : '');
    const text = String(raw).trim();
    if (!text) return { message: '', matched: false, rule: null };
    for (const r of RULES) {
        const m = text.match(r.test);
        if (m) return { message: r.copy(m), matched: true, rule: r.rule };
    }
    return { message: text, matched: false, rule: null };
}

/**
 * Restate suggestGasLimit's rationale as plain copy. Returns null when the
 * string is absent or is no longer the shape contracts.js emits.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function humanizeGasRationale(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) return null;
    const m = text.match(RATIONALE);
    if (!m) return null;
    const [, bytes, functions, loops, forLoops, emits, stateOps] = m;
    const parts = [
        plural(functions, 'function'),
        plural(loops, 'loop'),
        plural(emits, 'event emit'),
        plural(stateOps, 'state write'),
    ];
    // Counted `for` loops are metered twice per pass (body plus the update
    // expression), which is why the estimate jumps when one is present.
    const doubled = Number(forLoops) > 0
        ? `, and ${plural(forLoops, 'counted for-loop')} that cost double per pass`
        : '';
    return `estimated from ${bytes} bytes of code: ${parts.join(', ')}${doubled}`;
}
