// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Answer one question about a checkout: does its origin carry commits, touching
// the paths I am about to READ AS CANONICAL, that this checkout does not have?
//
// Generators that copy one repo's source into another repo's vendored artifact
// (xchain-wallet/bin/sync-chain-registry.mjs) read the LOCAL tree. Run from a
// stale clone, such a generator faithfully rewrites a superseded value into the
// consumer and the result looks exactly like a legitimate resync. That
// is how the hub's chain-registry snapshot kept a bitcoin-regtest encoder port
// the wallet had already corrected.
//
// Rules this file holds to:
//   - it never throws. A checkout can be a tarball, a detached CI checkout, or
//     have no upstream at all, and none of those are the caller's fault;
//   - "unanswerable" is a distinct verdict from "current". A caller that
//     refuses on staleness must not refuse on a question git could not answer;
//   - the fetch is optional and best-effort. Without one the answer is only as
//     fresh as the last `git fetch`, which is stated in `fetched`.

import { spawnSync } from 'node:child_process';

/** Run git in `cwd`, returning trimmed stdout or null when it fails. */
function git(cwd, args, timeoutMs) {
    const r = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        // The caller decides what to print; a raw git error here is noise.
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error || r.status !== 0) return null;
    return (r.stdout || '').trim();
}

/**
 * @typedef {object} Freshness
 * @property {boolean} git          the directory is a git work tree
 * @property {boolean} answerable   `behind` carries a real count
 * @property {number|null} behind   origin-only commits touching `paths`
 * @property {number|null} behindAll origin-only commits anywhere in the repo
 * @property {string|null} upstream the ref compared against, e.g. origin/master
 * @property {boolean} fetched      the upstream ref was refreshed just now
 * @property {string|null} reason   why the question could not be answered
 */

/**
 * How far behind its own origin is `repoRoot`, counted over `paths` only.
 *
 * Scoping matters as much as the count: a shared checkout is behind origin most
 * of the working day, so a guard that fired on any staleness would fire on
 * nearly every run and be switched off within a week. Only commits touching the
 * files being copied can change what the generator writes.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot     work tree to examine
 * @param {string[]} [opts.paths]    pathspecs, relative to repoRoot; [] = whole repo
 * @param {boolean} [opts.fetch]     refresh the upstream ref first (network)
 * @param {number} [opts.timeoutMs]  per-git-command ceiling
 * @returns {Freshness}
 */
export function checkoutFreshness({ repoRoot, paths = [], fetch = false, timeoutMs = 15000 } = {}) {
    const out = {
        git: false, answerable: false, behind: null, behindAll: null,
        upstream: null, fetched: false, reason: null,
    };

    if (git(repoRoot, ['rev-parse', '--is-inside-work-tree'], timeoutMs) !== 'true') {
        out.reason = 'not a git checkout';
        return out;
    }
    out.git = true;

    // The tracking branch, not a guessed origin/master: a checkout on a topic
    // branch, a fork, or a mirror remote must be compared against ITS upstream
    // or the count is fiction.
    const upstream = git(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], timeoutMs);
    if (!upstream) {
        // Detached HEAD (every GitHub Actions checkout) and branches with no
        // tracking ref land here. Unanswerable, never a refusal.
        out.reason = 'HEAD has no upstream branch';
        return out;
    }
    out.upstream = upstream;

    if (fetch) {
        const slash = upstream.indexOf('/');
        const remote = slash > 0 ? upstream.slice(0, slash) : 'origin';
        const branch = slash > 0 ? upstream.slice(slash + 1) : upstream;
        // Updates refs/remotes/<remote>/<branch> and nothing else: no merge, no
        // checkout, no working-tree change. Offline is normal, so a failure
        // downgrades the answer's freshness instead of failing the run.
        out.fetched = git(repoRoot, ['fetch', '--quiet', remote, branch], timeoutMs) !== null;
        if (!out.fetched) out.reason = `could not fetch ${remote}/${branch}; comparing against the last fetched ref`;
    }

    const count = (pathspec) => {
        const raw = git(repoRoot, ['rev-list', '--count', `HEAD..${upstream}`, '--', ...pathspec], timeoutMs);
        const n = raw === null ? NaN : Number.parseInt(raw, 10);
        return Number.isNaN(n) ? null : n;
    };
    out.behindAll = count([]);
    out.behind = paths.length ? count(paths) : out.behindAll;
    if (out.behind === null) {
        out.answerable = false;
        out.reason = out.reason || `could not compare HEAD against ${upstream}`;
        return out;
    }
    out.answerable = true;
    return out;
}

/**
 * One line describing a stale checkout, or null when it is current or the
 * question was unanswerable. Callers print this; the verdict is theirs.
 */
export function stalenessMessage(freshness, label) {
    if (!freshness || !freshness.answerable || !freshness.behind) return null;
    const all = freshness.behindAll === null ? '?' : freshness.behindAll;
    return `${label} is behind ${freshness.upstream}: ${freshness.behind} origin-only commit(s) `
        + `touch it (${all} in the repo overall)`
        + (freshness.fetched ? '' : ', measured against the last fetched ref');
}
