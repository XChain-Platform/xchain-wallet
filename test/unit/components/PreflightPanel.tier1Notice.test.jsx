// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PreflightPanel Tier-1 notice contract (; spec §4.2 "which party said
// what", §5.2.4 panel).
//
// The defect: `PreflightPanel` rendered only `error` and `warning` findings
// plus the unverified list, and the SDK emits `DRYRUN_UNAVAILABLE` at severity
// `info` - so a report whose dry-run TIMED OUT rendered nothing at all about
// the network and fell back to the same "Looks good" chip a real network
// approval produces. Two materially different states, one pixel-identical
// screen, and the lie runs in the unsafe direction: the user is told the
// network is happy about an action the network never saw.
//
// Found by the drive on the the regtest host regtest venue, where a cold
// dry-run costs 1.2s-5.0s and the SDK budget is 4000ms
// (xchain-sdk/src/preflight/constants.js DEFAULT_TIMEOUT_MS). The missing
// verdict read as a wallet defect to an experienced reader and cost most of
// that session, which is the strongest evidence the surface was wrong.
//
// The report fixtures below are the SHAPES the SDK actually produces; the
// `unreachedReport` findings array was captured from a live `sdk.preflight`
// run against a mock explorer whose `getFeeQuote` never resolves.
//
// NOT covered here, deliberately: reports with no Tier-1 finding at ALL
// (`local` mode, the DEPLOY/EXECUTE/XEXEC/BATCH denylist, `feeExempt`
// responses like DISPENSE). Those are spec §4.3 cases where Tier 1 was never
// asked rather than asked-and-silent; the panel exposes them as
// `data-dryrun="none"` if that ever needs its own copy.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreflightPanel, TIER1_NOTICE_CODES, SUPPORTED_SCHEMA_VERSION }
    from '../../../packages/core/src/shared/components/PreflightPanel.jsx';

// WHERE THE SDK COMES FROM, and it is not a sibling any more.
//
// This was a top-level `import ... from '../../../../xchain-sdk/src/preflight/constants.js'`,
// four levels up, i.e. a checkout sitting BESIDE the wallet. That path exists on
// a developer box working both repos and nowhere else: the `test` job in
//.github/workflows/ci.yml checks out this repository alone, and DD6
// the shells consume the published `@dankest-llc/xchain-sdk` instead. An
// unresolvable static import is a vitest COLLECTION error, so the whole
// regression file - every rendering case below, not just the parity ones - died
// before a single assertion ran, and took `pnpm test:unit` red with it.
//
// Resolved at runtime instead, through the same `xchain-sdk` alias the shells
// import, which reads the SDK the wallet actually SHIPS. A sibling checkout is
// still honoured when one is present so working across both repos locally keeps
// behaving as before. This is verbatim the pattern
// test/integration/hd/wallet-sdk-derivation-parity.test.js already uses, down to
// the XCHAIN_REQUIRE_SIBLINGS escape below; the path depth is identical.
const here = dirname(fileURLToPath(import.meta.url));
const requireFromCore = createRequire(join(here, '..', '..', '..', 'packages', 'core', 'package.json'));
const sdkFile = (...parts) => {
    const spec = `xchain-sdk/${parts.join('/')}`;
    try {
        return requireFromCore.resolve(spec);
    } catch {
        const sibling = join(here, '..', '..', '..', '..', 'xchain-sdk', ...parts);
        return existsSync(sibling) ? sibling : null;
    }
};
const constantsPath = sdkFile('src', 'preflight', 'constants.js');
const preflightConstants = constantsPath === null ? null : createRequire(import.meta.url)(constantsPath);

afterEach(cleanup);

const reportWith = (verdict, findings = []) => ({
    schemaVersion: 1,
    verdict,
    restricted: false,
    checksRun: [],
    findings,
    unverified: [],
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

// Exactly what applyTier1 pushes when runTier1 returns { kind: 'unavailable' }.
const DRYRUN_UNAVAILABLE_FINDING = {
    code: 'DRYRUN_UNAVAILABLE',
    severity: 'info',
    source: 'dryrun',
    message: 'The network dry-run was unavailable (tier1 timeout after 4000ms); relying on client checks.',
    data: {},
};

// ...and what it pushes on a genuine network approval.
const DRYRUN_VALID_FINDING = {
    code: 'DRYRUN_VALID',
    severity: 'info',
    source: 'dryrun',
    message: 'The network dry-run accepted this action.',
    data: {},
};

const mount = (report) =>
    render(<PreflightPanel report={report} acknowledged={new Set()} onAcknowledge={() => {}} />);

const panel = () => screen.getByTestId('preflight-panel');
const chip = () => screen.getByTestId('preflight-chip');

describe('PreflightPanel Tier-1 notice (§4.2, )', () => {

    // THE regression. One assertion, and it is the whole item.
    it('does NOT call an unreached network "Looks good"', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(chip().textContent).not.toContain('Looks good');
    });

    it('says on the surface that the network was not reached', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE');
        expect(notice.textContent).toMatch(/not reached/i);
        // And it says what the absence MEANS, since "unavailable" alone reads
        // as a shrug rather than as "this is not an approval".
        expect(notice.textContent).toMatch(/not a network approval/i);
    });

    // The reason is the half that cost the session: "timeout after
    // 4000ms" is what tells a reader the venue was slow, not the wallet broken.
    it('keeps the SDK reason visible as the diagnostic detail', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE').textContent)
            .toContain('timeout after 4000ms');
    });

    // Session 34. The SDK routes a DECLINED Tier-1 answer through this same
    // code (a controller-bound action, a denylisted VM action, a fee-exempt
    // reply): the network was reached and refused to judge, which is not an
    // approval either. The headline therefore has to be true of BOTH states,
    // which "the network was not reached" was not.
    const DRYRUN_DECLINED_FINDING = {
        code: 'DRYRUN_UNAVAILABLE',
        severity: 'info',
        source: 'dryrun',
        message: 'The network declined to judge this action (guardInert); relying on client checks.',
        data: {},
    };

    it('does NOT call a DECLINED verdict "Looks good" either', () => {
        mount(reportWith('pass', [DRYRUN_DECLINED_FINDING]));
        expect(chip().textContent).not.toContain('Looks good');
        expect(chip().textContent).toMatch(/local checks only/i);
        expect(panel().getAttribute('data-dryrun')).toBe('unreached');
    });

    it('states the DECLINED reason without claiming the network was unreachable', () => {
        mount(reportWith('pass', [DRYRUN_DECLINED_FINDING]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE');
        // The headline must not assert unreachability on an answer that
        // arrived; the SDK's own words carry which of the two states it was.
        expect(notice.textContent).not.toMatch(/network was not reached/i);
        expect(notice.textContent).toMatch(/not a network approval/i);
        expect(notice.textContent).toMatch(/declined to judge/i);
        expect(notice.textContent).toContain('guardInert');
    });

    it('states the network verdict when the network DID answer', () => {
        mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        expect(chip().textContent).toBe('Looks good');
        expect(screen.getByTestId('preflight-notice-DRYRUN_VALID').textContent)
            .toMatch(/network checked this action/i);
    });

    // The property the item is really about: two different states must not
    // produce the same screen. Comparing whole rendered text pins it against
    // any future refactor that drops one of the two branches.
    it('renders visibly DIFFERENT text for approved vs never-answered', () => {
        const { unmount } = mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        const approvedText = panel().textContent;
        unmount();

        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(panel().textContent).not.toBe(approvedText);
    });

    it('exposes the Tier-1 state machine-readably for e2e', () => {
        const { unmount } = mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(panel().getAttribute('data-dryrun')).toBe('unreached');
        unmount();

        const second = mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        expect(panel().getAttribute('data-dryrun')).toBe('approved');
        second.unmount();

        mount(reportWith('pass', []));
        expect(panel().getAttribute('data-dryrun')).toBe('none');
    });

    // Tier-1 precedence demotes a contradicting Tier-2 ERROR to info and keeps
    // it for diagnostics (`_downgradedBy`). Those must stay unrendered: putting
    // "insufficient balance" under a chip that says the network accepted the
    // action would contradict the verdict on the same screen, and the SDK
    // demoted it precisely because the network outranks it.
    it('does not render findings Tier-1 precedence demoted to info', () => {
        mount(reportWith('pass', [
            DRYRUN_VALID_FINDING,
            {
                code: 'BALANCE_INSUFFICIENT',
                severity: 'info',
                source: 'client',
                message: 'Insufficient JDOG balance',
                _downgradedBy: 'dryrun-valid',
                data: {},
            },
        ]));
        expect(screen.queryByTestId('preflight-notice-BALANCE_INSUFFICIENT')).toBeNull();
        expect(panel().textContent).not.toContain('Insufficient JDOG balance');
    });

    // A warn or fail verdict already has a chip that demands attention, so the
    // chip keeps its wording; the notice still has to appear, because "warnings
    // AND nobody checked with the network" is strictly worse than "warnings".
    it('keeps the warn chip but still declares the unreached network', () => {
        mount(reportWith('warn', [
            DRYRUN_UNAVAILABLE_FINDING,
            { code: 'NATIVE_FEE_FORFEIT', severity: 'warning', source: 'client', message: 'Fee may be forfeited', data: {} },
        ]));
        expect(chip().textContent).toBe('Review warnings');
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE')).toBeTruthy();
    });

    it('keeps the fail chip and its assertive live region when unreached', () => {
        mount(reportWith('fail', [
            DRYRUN_UNAVAILABLE_FINDING,
            { code: 'DEST_ADDRESS_INVALID', severity: 'error', source: 'client', overridable: false, message: 'Bad address', data: {} },
        ]));
        expect(chip().textContent).toBe('Will likely fail');
        expect(panel().getAttribute('aria-live')).toBe('assertive');
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE')).toBeTruthy();
        // A failing chip keeps the danger palette. The unreached style is
        // declared after the verdict styles, so an ungated class would win the
        // cascade and mute the loudest chip on the surface.
        expect(chip().className).not.toMatch(/chip_unreached/);
    });

    // Severity must never be carried by colour alone (§5.2.4). The unreached
    // state changes the WORDS in the chip, not just its palette.
    it('carries the unreached state in words, not only in styling', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(chip().textContent.trim().length).toBeGreaterThan(0);
        expect(chip().textContent).toMatch(/local checks only/i);
        // The palette moves too, and the pass arm is the one that must: this is
        // the other side of the fail-chip assertion above.
        expect(chip().className).toMatch(/chip_unreached/);
    });

});

// A BATCH is answered at TWO levels and the outer one is not a verdict on the
// inner ones: `valid:true` means the transaction is accepted and its commands
// run, not that any of them succeed. The panel's DRYRUN_VALID copy was a fixed
// string written when that code carried one state, so it overwrote the sentence
// the SDK had begun varying per outcome - and a batch the network explicitly
// declined to judge rendered "expects it to succeed" under a "Looks good" chip.
//
// The fixtures below are copied from what applyTier1 / pushSubCommandFindings
// actually push (xchain-sdk src/preflight/index.js), messages included, because
// the defect was precisely that the panel stopped reading them.
describe('PreflightPanel BATCH sub-command verdicts (§4.2)', () => {

    const batchValid = (subCommandCount, accepted) => ({
        code: 'DRYRUN_VALID',
        severity: 'info',
        source: 'dryrun',
        message: accepted === subCommandCount
            ? `The network dry-run accepted this batch and all ${subCommandCount} of its commands.`
            : 'The network dry-run accepted this batch transaction, but NOT every command in it'
              + ` (${accepted} of ${subCommandCount} accepted); see the per-command findings.`,
        data: { subCommandCount, accepted },
    });

    const unjudged = (position, action) => ({
        code: 'DRYRUN_SUBCOMMAND_UNJUDGED',
        severity: 'info',
        source: 'dryrun',
        message: `The network did not judge batch command ${position + 1} (${action})`
            + ' (the read-only pre-flight cannot evaluate this command);'
            + ' relying on client checks for it.',
        data: { commandIndex: position, action, refused: null },
    });

    it('keeps the approval chip when the network accepted every command', () => {
        mount(reportWith('pass', [batchValid(3, 3)]));
        expect(chip().textContent).toBe('Looks good');
        expect(panel().getAttribute('data-dryrun')).toBe('approved');
        expect(screen.getByTestId('preflight-notice-DRYRUN_VALID').textContent)
            .toMatch(/expects it to succeed/i);
    });

    // THE regression, one level down from the unreached one above: an outer
    // acceptance is not an approval of what is inside it.
    it('does NOT say a partly-accepted batch is expected to succeed', () => {
        mount(reportWith('pass', [batchValid(3, 2)]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_VALID');
        expect(notice.textContent).not.toMatch(/expects it to succeed/i);
        expect(notice.textContent).toMatch(/did NOT confirm every command/i);
        expect(notice.textContent).toMatch(/2 of 3/);
    });

    it('does not wear the approval chip or signal for a partly-accepted batch', () => {
        mount(reportWith('pass', [batchValid(3, 2)]));
        expect(chip().textContent).not.toContain('Looks good');
        expect(chip().textContent).toMatch(/partly checked/i);
        expect(panel().getAttribute('data-dryrun')).toBe('partial');
        // Severity is never colour-only, and a partial answer must not wear the
        // success palette any more than an unreached one does.
        expect(chip().className).toMatch(/chip_unreached/);
    });

    // The measured shape (BTC regtest 2026-08-13): a settlement leg inside a
    // BATCH answers with no status at all, so the network judged NOTHING while
    // still accepting the transaction. Every finding is `info`, so the verdict
    // is 'pass' and nothing else on the screen contradicts the chip.
    it('does not call an unjudged-only batch approved', () => {
        mount(reportWith('pass', [unjudged(0, 'COINPAY'), batchValid(1, 0)]));
        expect(chip().textContent).not.toContain('Looks good');
        expect(panel().getAttribute('data-dryrun')).toBe('partial');
        expect(screen.getByTestId('preflight-notice-DRYRUN_SUBCOMMAND_UNJUDGED').textContent)
            .toMatch(/did not judge/i);
    });

    // The SDK's own sentence carries WHICH command and why; the headline says
    // what the silence means. Losing either half loses the point.
    it('renders the producer sentence beneath the headline, not instead of it', () => {
        mount(reportWith('pass', [unjudged(2, 'COINPAY'), batchValid(3, 2)]));
        const valid = screen.getByTestId('preflight-notice-DRYRUN_VALID').textContent;
        expect(valid).toMatch(/did NOT confirm every command/i);   // panel headline
        expect(valid).toMatch(/see the per-command findings/i);    // SDK detail
        const note = screen.getByTestId('preflight-notice-DRYRUN_SUBCOMMAND_UNJUDGED').textContent;
        expect(note).toMatch(/not a network approval of it/i);     // panel headline
        expect(note).toMatch(/batch command 3 \(COINPAY\)/);       // SDK detail
    });

    // A probe carries no outputs, so the arbiter DISCLOSES oracle fees instead
    // of judging them. Its wording ("Size those outputs yourself") addresses
    // whoever composes the transaction, not whoever is about to sign it.
    it('gives the oracle-fee disclosure a signer-facing headline', () => {
        mount(reportWith('pass', [batchValid(2, 2), {
            code: 'DRYRUN_ORACLE_FEES_OWED',
            severity: 'info',
            source: 'dryrun',
            message: 'This batch owes oracle usage fees the pre-flight discloses rather than checks: '
                + '5000 to bc1qoracle. Size those outputs yourself; the dry-run has no outputs to check them against.',
            data: { oracleFeesOwed: { bc1qoracle: 5000 } },
        }]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_ORACLE_FEES_OWED').textContent;
        expect(notice).toMatch(/cannot check are covered/i);
        expect(notice).toMatch(/5000 to bc1qoracle/);
    });

    // A producer this panel knows nothing about must not have approval copy put
    // in its mouth. The dev shell (packages/web/src/hostBridge.js) stamps
    // DRYRUN_VALID with no `data` over a message saying the opposite.
    it('lets an unknown producer speak for itself', () => {
        mount(reportWith('pass', [{
            code: 'DRYRUN_VALID',
            severity: 'info',
            source: 'client',
            overridable: false,
            message: 'Dev mock: no on-chain dry-run.',
        }]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_VALID').textContent;
        expect(notice).toContain('Dev mock: no on-chain dry-run.');
        expect(notice).not.toMatch(/expects it to succeed/i);
        // ...and it is said ONCE, not as a headline contradicted by its detail.
        expect(notice.match(/Dev mock/g)).toHaveLength(1);
    });

});

// Everything the panel hand-copies from the SDK, pinned against the SDK. The
// panel imports nothing from it at runtime (extension bundle), so these literals
// are the whole contract and nothing but a test can hold them to it.
//
// Its own describe because it is the only block here that needs the SDK
// resolved, so the absent-SDK gate below can cover exactly these cases and leave
// the rendering suite above running unconditionally.
describe('PreflightPanel <-> xchain-sdk contract', () => {
    if (preflightConstants === null) {
        // House convention (test/integration/hd/wallet-sdk-derivation-parity.test.js,
        // test/unit/ActionManifestConformance.test.js): skip when the SDK cannot be
        // resolved, UNLESS XCHAIN_REQUIRE_SIBLINGS=1, which the cross-repo drift job
        // sets and which then fails loud. A guard allowed to vanish silently is the
        // failure mode the guard exists to catch.
        it('contract guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error(
                    'xchain-sdk could not be resolved, either as the published package via the ' +
                    '`xchain-sdk` alias or as a sibling checkout. This block pins PreflightPanel\'s ' +
                    'hand-copied Tier-1 codes and report schema version against the SDK and must ' +
                    'run with the SDK present; XCHAIN_REQUIRE_SIBLINGS=1 was set but it is absent.'
                );
            }
            ctx.skip();
        });
        return;
    }

    // The panel duplicates the two Tier-1 codes as literals on purpose: it is
    // rendered by the extension approval root and must not pull the SDK into
    // that bundle. So the parity lives here, where importing the SDK is free
    // (#3935). A silent rename in the registry would otherwise leave the panel
    // matching a code the SDK no longer emits, failing the way the original
    // defect did: by rendering nothing.
    it('keeps the Tier-1 notice codes in parity with the SDK registry', () => {
        expect(TIER1_NOTICE_CODES.DRYRUN_VALID)
            .toBe(preflightConstants.FINDING_CODES.DRYRUN_VALID);
        expect(TIER1_NOTICE_CODES.DRYRUN_UNAVAILABLE)
            .toBe(preflightConstants.FINDING_CODES.DRYRUN_UNAVAILABLE);
        expect(TIER1_NOTICE_CODES.DRYRUN_SUBCOMMAND_UNJUDGED)
            .toBe(preflightConstants.FINDING_CODES.DRYRUN_SUBCOMMAND_UNJUDGED);
        expect(TIER1_NOTICE_CODES.DRYRUN_ORACLE_FEES_OWED)
            .toBe(preflightConstants.FINDING_CODES.DRYRUN_ORACLE_FEES_OWED);
        // Every pinned code must still exist in the registry, so a deletion is
        // caught rather than read as undefined matching undefined.
        const registry = Object.values(preflightConstants.FINDING_CODES);
        for (const code of Object.values(TIER1_NOTICE_CODES)) {
            expect(registry).toContain(code);
        }
    });

    // The assertion above only checks pinned ⊆ registry, so it catches a rename
    // or a deletion and is structurally blind to an ADDITION - which is exactly
    // how the panel's list fell three codes behind. This is the other direction.
    //
    // The two codes named below are deliberately NOT pinned: they arrive at
    // severity 'error' and render generically in the errors list, so the panel
    // never keys on their names and a rename cannot break it. Naming them here
    // rather than pinning them keeps the panel's copy map free of entries with
    // no consumer, while still forcing a NEW Tier-1 code to fail this test and
    // reach a human, which is the recurrence class.
    //
    // Family membership is read off the `DRYRUN_` prefix, which is what the
    // registry's own "Tier-1 headlines" block uses today. A Tier-1 code landing
    // under some other prefix would slip past; the durable fix for that is a
    // machine-readable group exported by the SDK beside TIER2_ERROR_CAPABLE,
    // which is an SDK-side change this repo cannot make.
    const RENDERED_BY_SEVERITY_NOT_BY_CODE = new Set([
        'DRYRUN_INVALID',
        'DRYRUN_SUBCOMMAND_INVALID',
    ]);

    it('accounts for every Tier-1 headline code the SDK registers', () => {
        const tier1 = Object.values(preflightConstants.FINDING_CODES)
            .filter((code) => code.startsWith('DRYRUN_'));
        // An empty family would make the loop below pass by iterating nothing,
        // which is the same reassuring green a real pass gives.
        expect(tier1.length).toBeGreaterThanOrEqual(6);

        const pinned = new Set(Object.values(TIER1_NOTICE_CODES));
        const unaccounted = tier1.filter(
            (code) => !pinned.has(code) && !RENDERED_BY_SEVERITY_NOT_BY_CODE.has(code),
        );
        expect(unaccounted).toEqual([]);

        // And the exemption list may not outlive its codes either: a name left
        // here after the registry dropped it is a stale exemption that would
        // silently excuse a future code reusing it.
        for (const code of RENDERED_BY_SEVERITY_NOT_BY_CODE) {
            expect(tier1).toContain(code);
        }
    });

    // The panel interprets the report's fields and never reads
    // report.schemaVersion; the SDK's src/preflight/constants.js (comment above
    // REPORT_SCHEMA_VERSION) names this assertion as the additive-only rule's
    // enforcement point. It fires when the wallet upgrades to an SDK that bumped
    // the version, which is the moment a human has to re-read the panel's field
    // handling; see SUPPORTED_SCHEMA_VERSION in PreflightPanel.jsx for why the
    // enforcement is build-time and not a runtime degrade path.
    it('is written against the SDK report schema version the SDK still emits', () => {
        expect(SUPPORTED_SCHEMA_VERSION).toBe(preflightConstants.REPORT_SCHEMA_VERSION);
    });

    // The pin is only worth having while the panel's fixtures are the shape the
    // SDK actually stamps. A report carrying some other version would mean the
    // fixtures above stopped describing reality, so assert the two agree.
    it('renders fixtures stamped with the supported schema version', () => {
        expect(reportWith('pass').schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    });

    // The SDK is not the only producer of this report. The wallet authors two
    // of its own - the dispenser buy panel's funding-only `restricted` report,
    // and the dev shell's mock preflight - and `findings[].code` is the identity
    // every code-keyed consumer matches on: the override key, the Approve gate,
    // the panel's ack test id, the notice copy map. A code invented at a call
    // site renders (the panel falls back to `f.message`) while matching nothing,
    // which is why the dispenser panel shipped `insufficient_funds` where the
    // registry defines BALANCE_INSUFFICIENT and no test noticed.
    //
    // Scanned at source rather than by rendering, because these findings are
    // built inside route/bridge modules that a unit test cannot reach without
    // standing up the whole route. The scan is narrow on purpose: two files,
    // both of which produce nothing but pre-flight findings, so there is no
    // allowlist to keep and nothing unrelated to filter out.
    const WALLET_REPORT_PRODUCERS = [
        ['packages', 'core', 'src', 'shared', 'routes', 'DispenserDetail.jsx'],
        ['packages', 'web', 'src', 'hostBridge.js'],
    ];

    it('keeps wallet-authored finding codes inside the SDK registry', () => {
        const registry = new Set(Object.values(preflightConstants.FINDING_CODES));
        const found = [];
        for (const parts of WALLET_REPORT_PRODUCERS) {
            const path = join(here, '..', '..', '..', ...parts);
            const src = readFileSync(path, 'utf8');
            for (const m of src.matchAll(/\bcode:\s*'([A-Za-z0-9_]+)'/g)) {
                found.push([parts.join('/'), m[1]]);
            }
        }
        // A producer that stopped emitting codes, or a regex that stopped
        // matching, would leave this loop iterating nothing and passing.
        expect(found.length).toBeGreaterThanOrEqual(3);
        expect(found.filter(([, code]) => !registry.has(code))).toEqual([]);
    });
});
