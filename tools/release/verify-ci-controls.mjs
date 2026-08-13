#!/usr/bin/env node
/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

// Measures the PUBLIC release-CI page against the repository's actual
// settings, so that no control it names is one nobody ever checked.
//
// WHY THIS EXISTS. `components/wallet/release/ci-setup.md` is served at
// docs.xchain.io and its own opening says it is written "for anyone
// verifying that a release could only have come from an intentional
// run". A reader cannot see the repository settings, so every sentence on
// that page is something they take on trust. Twice now the page has
// described a control that does not exist: a per-run reviewer gate on the
// signing environment and a tag rule restricting who may create a release
// tag (both corrected 2026-08-04), and a third time it described signing
// credentials as environment-scoped while they were provisioned
// repository-wide two days after the page was written (found by this tool,
// 2026-08-12).
//
// The pattern is the same each time and it is not carelessness: prose about
// settings drifts because prose and settings are edited in different places
// by different acts, and nothing ever compares them. `release-ci.smoke.js`
// pins the page's WORDING and runs offline, which is the half that can be
// gated in CI. This is the other half. It reads the live settings.
//
// FAIL-CLOSED. Every way of not knowing is a refusal: no `gh`, no token,
// an endpoint this plan tier does not expose, a control named by a page
// section this tool has no probe for. "We did not look" must never print
// the same way as "we looked and it was good", which is the same rule the
// page states for artifact signatures.
//
// NOT part of `npm run ci`: it needs network and an authenticated `gh`.
// Run it before a release and after any change to the page or the
// repository's settings.
//
//   node tools/release/verify-ci-controls.mjs [--json]
//
// Docs page location: the sibling xchain-documentation checkout, or
// XCHAIN_DOCS_ROOT.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const REPO = process.env.XCHAIN_WALLET_REPO || 'XChain-Platform/xchain-wallet';
const ENVIRONMENT = 'release-signing';
const TAG_PATTERN = 'v*';

const docsRoot = process.env.XCHAIN_DOCS_ROOT
    || resolve(root, '..', 'xchain-documentation');
const DOC_REL = 'components/wallet/release/ci-setup.md';
const DOC = join(docsRoot, DOC_REL);

// --help before anything else, and before any network call: a release tool is
// typed by an operator mid-ceremony, and the one thing it must never do when
// asked how to use it is start doing its job.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: node tools/release/verify-ci-controls.mjs [--json]

verify-ci-controls.mjs measures the public release-CI page against the live
repository settings, so that no control the page names is one nobody checked.

  --json   emit the findings as JSON instead of a table
  --help   show this

Reads (never writes) with an authenticated \`gh\`. Needs network, so it is not
part of \`npm run ci\`; run it before a release and after any change to the page
or to the repository's settings.

Verdicts: PASS confirmed by the settings - FAIL contradicted by them -
UNKNOWN could not be measured, which is a refusal and not a pass - N/A not
applicable yet, with the reason - UNCOVERED the page names a control this tool
has no probe for. Exit 0 only when nothing is FAIL, UNKNOWN or UNCOVERED.

Environment:
  XCHAIN_DOCS_ROOT      the xchain-documentation checkout holding the page
                        (default: the sibling of this repository)
  XCHAIN_WALLET_REPO    owner/name to audit (default: ${REPO})
`);
    process.exit(0);
}

const json = process.argv.includes('--json');
const findings = [];
const record = (control, verdict, detail) => findings.push({ control, verdict, detail });

// --- reading the live settings -----------------------------------------

// Every failure mode of `gh` collapses to "unknown", which is a refusal,
// never a pass.
function gh(path) {
    try {
        const out = execFileSync('gh', ['api', path], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { ok: true, body: JSON.parse(out) };
    } catch (err) {
        const stderr = `${err.stderr || err.message || ''}`.trim().split('\n')[0];
        return { ok: false, error: stderr || 'gh api failed' };
    }
}

// --- reading the page ---------------------------------------------------

if (!existsSync(DOC)) {
    console.error(`FAIL: cannot read ${DOC_REL}. Set XCHAIN_DOCS_ROOT to the `
        + 'xchain-documentation checkout. The page cannot be audited against the '
        + 'settings it describes if it cannot be read, and an unaudited page is '
        + 'the state this tool exists to end.');
    process.exit(2);
}
const page = readFileSync(DOC, 'utf8');
const flat = page.replace(/\s+/g, ' ');

// Numbered sections are how this page names a control. A section this tool
// has no probe for is the headline failure: the page would be asserting
// something to the public that nothing measures.
const sections = [...page.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => ({
    number: m[1], title: m[2].trim(),
}));

// id -> which section it belongs to, what the page says, and how to measure it.
const PROBES = [
    {
        id: 'signing-environment-tag-restricted',
        section: '1',
        says: 'signing jobs run in a deployment environment restricted to the release tag pattern',
        asserted: () => /restricted to the release tag pattern/i.test(flat),
        measure() {
            const envs = gh(`repos/${REPO}/environments`);
            if (!envs.ok) return { verdict: 'UNKNOWN', detail: envs.error };
            const env = (envs.body.environments || []).find((e) => e.name === ENVIRONMENT);
            if (!env) return { verdict: 'FAIL', detail: `no '${ENVIRONMENT}' environment exists` };
            const policies = gh(`repos/${REPO}/environments/${ENVIRONMENT}/deployment-branch-policies`);
            if (!policies.ok) return { verdict: 'UNKNOWN', detail: policies.error };
            const list = policies.body.branch_policies || [];
            const tag = list.find((p) => p.type === 'tag' && p.name === TAG_PATTERN);
            if (!tag) {
                return {
                    verdict: 'FAIL',
                    detail: `policies are [${list.map((p) => `${p.type}:${p.name}`).join(', ') || 'none'}], `
                        + `expected a tag policy '${TAG_PATTERN}'`,
                };
            }
            const branchy = list.filter((p) => p.type !== 'tag');
            if (branchy.length) {
                return {
                    verdict: 'FAIL',
                    detail: `the environment also admits ${branchy.map((p) => p.name).join(', ')}, `
                        + 'so it is not restricted to the release tag pattern',
                };
            }
            return { verdict: 'PASS', detail: `tag policy '${TAG_PATTERN}', and nothing else` };
        },
    },
    {
        id: 'signing-credentials-environment-scoped',
        section: '2',
        says: 'every signing credential is scoped to that environment, never repository-wide',
        asserted: () => /never stored as a repository-wide secret/i.test(flat),
        measure() {
            // The credential NAMES come from the workflow rather than a list
            // here, so adding a signing secret cannot quietly fall outside
            // the audit.
            const wanted = signingSecretNames();
            if (!wanted.length) {
                return { verdict: 'UNKNOWN', detail: 'no signing secrets found in release.yml to check' };
            }
            const envSecrets = gh(`repos/${REPO}/environments/${ENVIRONMENT}/secrets`);
            const repoSecrets = gh(`repos/${REPO}/actions/secrets`);
            if (!envSecrets.ok) return { verdict: 'UNKNOWN', detail: envSecrets.error };
            if (!repoSecrets.ok) return { verdict: 'UNKNOWN', detail: repoSecrets.error };
            const inEnv = new Set((envSecrets.body.secrets || []).map((s) => s.name));
            const inRepo = new Set((repoSecrets.body.secrets || []).map((s) => s.name));
            // Absent everywhere means the credential is simply not provisioned
            // yet. That is not this control failing, and reporting it as such
            // would train a reader to ignore the real failure below.
            const repoWide = wanted.filter((n) => inRepo.has(n));
            const unscoped = wanted.filter((n) => !inRepo.has(n) && !inEnv.has(n));
            if (repoWide.length) {
                return {
                    verdict: 'FAIL',
                    detail: `${repoWide.length} signing credential(s) are REPOSITORY-wide, readable by `
                        + `any workflow in the repo: ${repoWide.join(', ')}`
                        + `${inEnv.size ? `; ${inEnv.size} are environment-scoped` : '; none are environment-scoped'}`,
                };
            }
            if (!inEnv.size) {
                return {
                    verdict: 'UNKNOWN',
                    detail: `no signing credentials are provisioned in either scope `
                        + `(${unscoped.length} named by release.yml), so the page's claim is untested`,
                };
            }
            return { verdict: 'PASS', detail: `${inEnv.size} environment-scoped, 0 repository-wide` };
        },
    },
    {
        id: 'signed-tag-required',
        section: '3',
        says: 'a release tag must carry a signature from the release tag-signing key, checked before any signing job',
        asserted: () => /tag must carry a cryptographic signature from the maintainer/i.test(flat),
        measure() {
            const wf = remoteWorkflow();
            if (!wf.ok) return { verdict: 'UNKNOWN', detail: wf.error };
            if (!/git verify-tag/.test(wf.text)) {
                return { verdict: 'FAIL', detail: 'release.yml on the default branch runs no `git verify-tag`' };
            }
            const jobs = jobBlocks(wf.text);
            const ungated = [...jobs]
                .filter(([name, block]) => name !== 'verify-tag'
                    && /environment:\s*release-signing/.test(block)
                    && !/needs:[^\n]*verify-tag|needs:\s*\n(?:\s+- [^\n]*\n)*?\s+- verify-tag/.test(block))
                .map(([name]) => name);
            if (ungated.length) {
                return {
                    verdict: 'FAIL',
                    detail: `signing job(s) do not depend on verify-tag: ${ungated.join(', ')}`,
                };
            }
            return { verdict: 'PASS', detail: 'verify-tag runs `git verify-tag` and gates every signing job' };
        },
    },
    {
        id: 'artifact-signature-check-before-manifest',
        section: '2',
        says: 'every artifact is checked for its expected code signature before the hash manifest is signed',
        asserted: () => /every artifact is checked against the code signature/i.test(flat),
        measure() {
            const tool = join(root, 'tools', 'release', 'verify-signatures.mjs');
            if (!existsSync(tool)) {
                return { verdict: 'FAIL', detail: 'tools/release/verify-signatures.mjs is missing' };
            }
            const signSh = join(root, 'tools', 'release', 'sign.sh');
            if (!existsSync(signSh)) return { verdict: 'UNKNOWN', detail: 'tools/release/sign.sh is missing' };
            const sh = readFileSync(signSh, 'utf8');
            if (!/verify-signatures/.test(sh)) {
                return {
                    verdict: 'FAIL',
                    detail: 'sign.sh does not run verify-signatures, so the manifest can be signed over unsigned artifacts',
                };
            }
            return { verdict: 'PASS', detail: 'sign.sh runs verify-signatures before signing the manifest' };
        },
    },
    {
        id: 'no-release-trigger-outside-tags',
        section: '4',
        says: 'the release workflow triggers only on a tag push, never on a pull request',
        asserted: () => /triggers only on a tag push, never on a pull request/i.test(flat),
        measure() {
            const wf = remoteWorkflow();
            if (!wf.ok) return { verdict: 'UNKNOWN', detail: wf.error };
            const header = wf.text.split('\njobs:')[0];
            const bad = ['pull_request', 'pull_request_target', 'workflow_call', 'repository_dispatch']
                .filter((t) => new RegExp(`^\\s{2}${t}:`, 'm').test(header));
            if (bad.length) return { verdict: 'FAIL', detail: `also triggers on ${bad.join(', ')}` };
            if (!/tags:/.test(header)) return { verdict: 'FAIL', detail: 'no tag trigger found' };
            return { verdict: 'PASS', detail: 'tag push only, on the default branch copy' };
        },
    },
    {
        id: 'fork-runs-require-approval',
        section: '4',
        says: 'workflow runs proposed from a fork require explicit approval before they run',
        asserted: () => /from a fork require explicit approval/i.test(flat),
        measure() {
            // While the repository is private there are no outside forks to
            // approve, so the endpoint refuses and the control is genuinely
            // not applicable rather than missing. Reporting that as UNKNOWN
            // would leave one permanently amber row, which is how a report
            // teaches people to skim past it. It becomes a real check at the
            // public flip, and the N/A says so.
            if (isPrivate()) {
                return {
                    verdict: 'N/A',
                    detail: 'repository is private, so no fork can propose a run at all. '
                        + 'This becomes a live check at the public flip',
                };
            }
            const res = gh(`repos/${REPO}/actions/permissions/fork-pr-contributor-approval`);
            if (!res.ok) {
                return {
                    verdict: 'UNKNOWN',
                    detail: `cannot read the fork-run approval policy (${res.error}). The page states `
                        + 'it as a fact and nothing here can confirm it',
                };
            }
            const policy = res.body.approval_policy || res.body.state || JSON.stringify(res.body);
            if (/first_time|all_external|require/i.test(String(policy))) {
                return { verdict: 'PASS', detail: `approval_policy=${policy}` };
            }
            return { verdict: 'FAIL', detail: `approval_policy=${policy}` };
        },
    },
];

// Controls the page states are ABSENT. These are audited too, in the other
// direction: if one of them quietly comes into existence the page becomes
// wrong by understatement, which is the safe direction but still wrong, and
// a reader who checks and finds a control the page denies stops trusting
// the rest of it.
const ABSENCES = [
    {
        id: 'no-reviewer-gate',
        says: 'there is no human approval step on the signing environment',
        asserted: () => /there is no human approval step/i.test(flat),
        measure() {
            const envs = gh(`repos/${REPO}/environments`);
            if (!envs.ok) return { verdict: 'UNKNOWN', detail: envs.error };
            const env = (envs.body.environments || []).find((e) => e.name === ENVIRONMENT);
            if (!env) return { verdict: 'UNKNOWN', detail: `no '${ENVIRONMENT}' environment` };
            const types = (env.protection_rules || []).map((r) => r.type);
            const reviewers = types.filter((t) => t === 'required_reviewers');
            if (reviewers.length) {
                return { verdict: 'FAIL', detail: 'a required_reviewers rule EXISTS; the page denies it' };
            }
            return { verdict: 'PASS', detail: `protection rules are [${types.join(', ') || 'none'}]` };
        },
    },
    {
        id: 'no-tag-ruleset',
        says: 'there is no rule restricting who can create a release tag',
        asserted: () => /there is no rule restricting who can create a release tag/i.test(flat),
        measure() {
            const res = gh(`repos/${REPO}/rulesets`);
            if (!res.ok) return { verdict: 'UNKNOWN', detail: res.error };
            const rulesets = Array.isArray(res.body) ? res.body : [];
            const tagRules = rulesets.filter((r) => r.target === 'tag');
            if (tagRules.length) {
                return {
                    verdict: 'FAIL',
                    detail: `${tagRules.length} tag ruleset(s) EXIST; the page denies it: `
                        + tagRules.map((r) => r.name).join(', '),
                };
            }
            return { verdict: 'PASS', detail: `${rulesets.length} ruleset(s), none targeting tags` };
        },
    },
];

// --- shared readers -----------------------------------------------------

let privateCache;
function isPrivate() {
    if (privateCache === undefined) {
        const res = gh(`repos/${REPO}`);
        // Unknown visibility resolves to "public", the stricter reading: it
        // keeps the fork-approval row a real check rather than letting an API
        // failure excuse it.
        privateCache = res.ok ? Boolean(res.body.private) : false;
    }
    return privateCache;
}

let workflowCache;
function remoteWorkflow() {
    // The DEFAULT BRANCH copy, not the worktree. A local edit that has not
    // been pushed is not a control anyone else is protected by, and this
    // tree is shared.
    if (workflowCache) return workflowCache;
    const res = gh(`repos/${REPO}/contents/.github/workflows/release.yml?ref=HEAD`);
    if (!res.ok) { workflowCache = { ok: false, error: res.error }; return workflowCache; }
    const text = Buffer.from(res.body.content || '', 'base64').toString('utf8');
    workflowCache = text ? { ok: true, text } : { ok: false, error: 'release.yml came back empty' };
    return workflowCache;
}

function jobBlocks(text) {
    const lines = text.split('\n');
    const jobsAt = lines.findIndex((l) => l === 'jobs:');
    const out = new Map();
    if (jobsAt < 0) return out;
    let current = null;
    for (const line of lines.slice(jobsAt + 1)) {
        const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (m) { current = m[1]; out.set(current, []); continue; }
        if (current) out.get(current).push(line);
    }
    return new Map([...out].map(([k, v]) => [k, v.join('\n')]));
}

function signingSecretNames() {
    const wf = remoteWorkflow();
    if (!wf.ok) return [];
    const names = new Set();
    for (const [, block] of jobBlocks(wf.text)) {
        if (!/environment:\s*release-signing/.test(block)) continue;
        for (const m of block.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
            // Feed URLs and identity strings are configuration, not credentials.
            if (/^(XCHAIN_|APPX_)/.test(m[1])) continue;
            names.add(m[1]);
        }
    }
    return [...names].sort();
}

// --- run ----------------------------------------------------------------

for (const probe of [...PROBES, ...ABSENCES]) {
    if (!probe.asserted()) {
        record(probe.id, 'SKIP', 'the page does not state this; nothing to confirm');
        continue;
    }
    const { verdict, detail } = probe.measure();
    record(probe.id, verdict, detail);
}

// The headline check: a numbered section whose control nothing here probes.
//
// This is the check that makes the rest mean anything. Each probe above can
// only confirm a control someone thought to write a probe for; without this,
// the way the page acquires an unmeasured claim is simply by growing a new
// section, and the audit would go on printing all-green underneath it.
//
// Sections that describe a PROCEDURE rather than a setting are declared here
// by number, deliberately one at a time, so a new section is red until
// someone decides which kind it is.
const PROCEDURE_SECTIONS = new Map([
    ['5', 'a verification procedure, not a control: every step in it rests on a '
        + 'control probed above, and release-ci.smoke.js pins the list against its own count'],
]);
const covered = new Set(PROBES.map((p) => p.section));
for (const section of sections) {
    if (covered.has(section.number)) continue;
    const procedure = PROCEDURE_SECTIONS.get(section.number);
    if (procedure) {
        record(`section-${section.number}`, 'N/A', `"§${section.number}. ${section.title}" is ${procedure}`);
        continue;
    }
    record(`section-${section.number}`, 'UNCOVERED',
        `"§${section.number}. ${section.title}" names a control this audit has no probe for. `
        + 'Add one, or the page is telling the public something nobody measures');
}

// --- report -------------------------------------------------------------

if (json) {
    console.log(JSON.stringify({ repo: REPO, doc: DOC_REL, findings }, null, 2));
} else {
    console.log(`release CI controls: ${REPO}`);
    console.log(`page: ${DOC_REL}\n`);
    for (const f of findings) {
        console.log(`${f.verdict.padEnd(9)} ${f.control}`);
        if (f.detail) console.log(`          ${f.detail}`);
    }
}

const bad = findings.filter((f) => f.verdict === 'FAIL' || f.verdict === 'UNKNOWN'
    || f.verdict === 'UNCOVERED');
if (bad.length) {
    console.error(`\n${bad.length} control(s) the page names that the repository's settings do not `
        + 'confirm. The page is public and a reader uses it to decide whether a release could only '
        + 'have come from an intentional run, so each of these is either a settings change or a '
        + 'correction to the page.');
    process.exit(1);
}
console.log('\nEvery control the page names is confirmed by the live settings.');
