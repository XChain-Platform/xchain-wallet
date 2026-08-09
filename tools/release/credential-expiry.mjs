#!/usr/bin/env node
// The release-credential expiry clock ( §6, frontier row 121).
//
// WHY THIS FILE EXISTS. §6 records four dated credentials and calls the K3
// certificate's date "a renewal date and not a fact to forget". Nothing read
// it: a `git grep` for either date across `tools/`, `test/` and `.github/`
// found no hits at all. That is precisely §9's defect one packaging over -
// the Electron CVE cadence was prose until `electron-cadence.mjs` made it a
// clock - and the cost is higher here, because an expired signing certificate
// is not a slow drift. It is a release that builds clean, signs clean, passes
// every gate, and is refused by Gatekeeper on every user's machine.
//
// THE TRAP THIS TOOL REFUSES TO WALK INTO. A hand-maintained list of dates is
// itself a declaration nothing measures, which is how `expected-artifacts.txt`
// declared artifact CLASSES and never counted them, certifying half-built
// releases until . So the declared date is not the authority: each row
// names the artifact that CARRIES its expiry, and whenever that artifact is
// reachable this tool reads `notAfter` out of it and fails on any drift.
// Declaring and measuring disagree loudly rather than quietly.
//
// WHERE IT CAN AND CANNOT MEASURE. The credential material lives on the
// release machine (§6's 0600 store) and deliberately nowhere else, so CI has
// none of it. A row it cannot measure is reported as DECLARED-ONLY by name
// rather than silently trusted - the same posture as `PAYLOAD-ARCH-UNCHECKED`
// in lib.sh, which names what it could not open instead of passing it.
//
// EXIT CODES follow the house convention (electron-cadence.mjs):
//   0  current    every credential is outside the renewal lead time
//   1  due        actionable: something is inside the lead time, expired, or
//                 declared a date its own artifact does not carry
//   2  config     the declaration could not be read

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

const DAY_MS = 86_400_000;

/** `~/x` is the release machine's store; everything else is taken as given. */
export function expandHome(p, home = homedir()) {
    return p.startsWith('~/') ? join(home, p.slice(2)) : p;
}

/**
 * Read `notAfter` out of whatever the row points at.
 *
 * Two artifact shapes carry an expiry and they are read differently: an X.509
 * certificate through openssl, and an Apple provisioning profile, which is a
 * CMS-signed plist whose `ExpirationDate` is the date that matters. A profile
 * is NOT a certificate and reading it as one silently yields nothing, which is
 * why the two are separated here rather than tried in sequence.
 *
 * @returns {{date: Date|null, reason: string|null}}
 */
export function readActualExpiry(file, { run = execFileSync } = {}) {
    if (!existsSync(file)) return { date: null, reason: 'not present on this machine' };

    if (file.endsWith('.provisionprofile') || file.endsWith('.mobileprovision')) {
        try {
            const plist = run('security', ['cms', '-D', '-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const m = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(plist);
            if (!m) return { date: null, reason: 'no ExpirationDate in the profile' };
            return { date: new Date(m[1]), reason: null };
        } catch {
            return { date: null, reason: 'the profile could not be decoded (security cms failed)' };
        }
    }

    // A .cer may be DER or PEM and openssl will not guess; try the declared
    // form first and fall back, because Apple's downloads are DER and our own
    // exports are PEM and both live in the same directory.
    for (const form of ['PEM', 'DER']) {
        try {
            const out = run('openssl', ['x509', '-in', file, '-inform', form, '-noout', '-enddate'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const m = /notAfter=(.+)/.exec(out);
            if (m) return { date: new Date(m[1].trim()), reason: null };
        } catch { /* try the other encoding */ }
    }
    return { date: null, reason: 'not a certificate this tool can read' };
}

/**
 * Judge one credential against the clock and against its own artifact.
 *
 * @param {Object} cred    a row from credential-expiry.json
 * @param {Date}   now     the clock, injectable so the branches can be driven
 * @param {number} leadDays the renewal lead time in days
 */
export function assessOne(cred, now, leadDays, io = {}) {
    const declared = new Date(cred.expires);
    if (Number.isNaN(declared.getTime())) {
        return { id: cred.id, state: 'config', detail: `unparseable declared date "${cred.expires}"` };
    }

    const file = expandHome(cred.verifyFrom, io.home);
    const { date: actual, reason } = readActualExpiry(file, io);

    // Drift beats the calendar: if the declaration and the artifact disagree,
    // every day-count below is computed from a number nobody can trust.
    if (actual && Math.abs(actual.getTime() - declared.getTime()) > 1000) {
        return {
            id: cred.id,
            state: 'drift',
            detail: `declares ${declared.toISOString()} but ${cred.verifyFrom} carries ${actual.toISOString()}`,
        };
    }

    const days = Math.floor((declared.getTime() - now.getTime()) / DAY_MS);
    const measured = Boolean(actual);
    if (days < 0) return { id: cred.id, state: 'expired', days, measured, reason };
    if (days <= leadDays) return { id: cred.id, state: 'due', days, measured, reason };
    return { id: cred.id, state: 'current', days, measured, reason };
}

export function assess(declaration, now) {
    const leadDays = declaration.policy?.renewalLeadDays;
    if (typeof leadDays !== 'number') {
        return { code: 2, findings: [], error: 'policy.renewalLeadDays is missing or not a number' };
    }
    const rows = declaration.credentials;
    if (!Array.isArray(rows) || rows.length === 0) {
        return { code: 2, findings: [], error: 'no credentials declared' };
    }
    const findings = rows.map((c) => assessOne(c, now, leadDays));
    const bad = findings.filter((f) => f.state !== 'current');
    return { code: bad.some((f) => f.state === 'config') ? 2 : (bad.length ? 1 : 0), findings, leadDays };
}

const USAGE = `credential-expiry.mjs - are the release signing credentials still valid?

Usage:
  node tools/release/credential-expiry.mjs [--json]

Reads tools/release/credential-expiry.json, and for every row whose artifact
is reachable on this machine also reads the expiry out of the artifact itself,
failing on any disagreement.

EXIT CODES
  0  current  every credential is outside the renewal lead time
  1  due      inside the lead time, expired, or declared a date its own
              artifact does not carry
  2  config   the declaration could not be read
`;

export async function main(argv, { now = new Date(), log = console.log, err = console.error } = {}) {
    if (argv.includes('--help') || argv.includes('-h')) { log(USAGE); return 0; }

    let declaration;
    const path = join(here, 'credential-expiry.json');
    try {
        declaration = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        err(`config  ${path} could not be read: ${e.message}`);
        return 2;
    }

    const result = assess(declaration, now);
    if (result.error) { err(`config  ${result.error}`); return 2; }

    if (argv.includes('--json')) { log(JSON.stringify(result, null, 2)); return result.code; }

    const byId = new Map(declaration.credentials.map((c) => [c.id, c]));
    for (const f of result.findings) {
        const c = byId.get(f.id) || {};
        const how = f.measured ? 'measured' : `DECLARED-ONLY (${f.reason})`;
        if (f.state === 'drift') {
            err(`DRIFT     ${f.id}  ${f.detail}`);
        } else if (f.state === 'config') {
            err(`CONFIG    ${f.id}  ${f.detail}`);
        } else if (f.state === 'expired') {
            err(`EXPIRED   ${f.id}  ${-f.days} day(s) ago [${how}] - ${c.what}`);
            err(`          breaks: ${c.breaks}`);
        } else if (f.state === 'due') {
            err(`DUE       ${f.id}  in ${f.days} day(s) [${how}] - ${c.what}`);
            err(`          breaks: ${c.breaks}`);
        } else {
            log(`ok        ${f.id}  ${f.days} day(s) left [${how}]`);
        }
        if (c.note && f.state !== 'current') err(`          note: ${c.note}`);
    }

    log(result.code === 0
        ? `CURRENT   nothing expires within ${result.leadDays} days`
        : `ACTION    ${result.findings.filter((f) => f.state !== 'current').length} credential(s) need attention`);
    return result.code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main(process.argv.slice(2)).then((c) => process.exit(c));
}
