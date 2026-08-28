// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Is the venue fit to start a spec on? The pure half of
// `assertVenueReachable`, split out of `regtest.js` for the same reason
// `priceSeed.js` is split out: the states this code exists to catch appear on a
// shared dev stack once every few weeks and never on demand, so the only honest
// way to know the guard works is to hand it a RECORDED sick payload in a unit
// test. `regtest.js` imports `@playwright/test`; this file imports nothing, so
// vitest can drive it in milliseconds.
//
// See `test/unit/e2e-venue-verdict.test.js`, which carries the real bodies.

/**
 * Given the explorer's `/api/status` body, decide whether `coin`'s pipeline is
 * fit to start a spec on. Returns null when it is, else the sentence to put in
 * front of the operator.
 *
 * `chain_lag_blocks` ALONE IS NOT ENOUGH, and a day of this campaign was spent
 * proving it. On 2026-08-11 RDOGE sat 89 blocks behind - `last_block` 2064
 * against a `chain_tip` of 2153 - while `chain_lag_blocks.RDOGE` read 0 and
 * `decoder_tip` equalled `chain_tip`. Global setup passed, every spec then
 * failed somewhere deep inside the wallet, and the venue looked innocent the
 * whole time. The endpoint publishes two heights derived independently, so
 * compare THOSE and refuse to start when they disagree.
 *
 * Order is deliberate. `decoder_health` is checked first because a dead decoder
 * makes every other field meaningless: on 2026-08-27 RBTC published
 * `chain_tip: null` and `chain_lag_blocks: null` while its decoder crash-looped
 * on a REORG_HALT marker, and the old code's "reports no RBTC chain" would have
 * sent the reader to check tunnels that were fine.
 *
 * The height comparison is LAST of the two liveness checks on purpose: a chain
 * that is merely behind (lag > 2) is a wait, while one whose indexed height
 * disagrees with the tip while reporting zero lag is a WEDGE, and the reader
 * needs to be told which.
 */
export function venueVerdict(status, coin) {
    const health = status?.decoder_health?.[coin];
    if (health && health !== 'healthy') {
        return `Regtest ${coin} decoder reports "${health}". Read that container's log for the `
            + 'remedy; this is a venue outage, not a wallet defect.';
    }

    const lag = status?.chain_lag_blocks?.[coin];
    if (typeof lag !== 'number') {
        return `Explorer answered but reports no ${coin} chain.`;
    }

    // The INDEXER height against the NODE tip. `chain_lag_blocks` is NOT this
    // subtraction - it read 0 through the whole 89-block stall above.
    const tip = status?.chain_tip?.[coin];
    const indexed = status?.last_block?.[coin];
    if (typeof tip === 'number' && typeof indexed === 'number' && tip - indexed > 2) {
        return `Regtest ${coin} is WEDGED: the chain tip is ${tip} but only ${indexed} is indexed `
            + `(${tip - indexed} blocks behind), while chain_lag_blocks reports ${lag}. `
            + 'Do not start a spec on it - the failures will point at the wallet.';
    }

    if (lag > 2) {
        return `Regtest ${coin} indexer is ${lag} blocks behind; wait for it to catch up.`;
    }

    return null;
}

/**
 * One probe of the venue, mid-run, classified. Returns null when the venue is
 * answering and fit, else the sentence.
 *
 * `venueVerdict` above guards the START of a run and assumes it HAS a status
 * body. This is the other half: what a poll sees when the venue stops existing
 * underneath it. The shapes are different and so is the reader's next move.
 *
 * @param {{error?: unknown, httpStatus?: number, body?: unknown}} probe
 *   `error` is set when the fetch itself failed, `httpStatus` when it answered.
 */
export function probeVerdict(probe, coin) {
    if (probe?.error) {
        const detail = probe.error?.message || String(probe.error);
        // THE SHAPE THAT COST 13 MINUTES OF A RUN'S BUDGET, 2026-08-27. The
        // explorer container was recreated mid-session and `/api/status` stopped
        // answering for about six minutes. An ssh tunnel whose LOCAL listener is
        // still up while the forwarded service is gone accepts the connection
        // and then closes it, so this is a socket hang-up rather than a
        // refusal, and "connection refused" advice sends the reader to the
        // wrong end of the tunnel.
        return `the venue stopped answering mid-run: ${detail}. A tunnel whose local listener is `
            + 'up while the forwarded service is gone hangs up rather than refusing, so check the '
            + `container as well as the tunnel. Nothing about ${coin} or the wallet is proven by `
            + 'whatever this spec was waiting for.';
    }

    if (typeof probe?.httpStatus === 'number' && (probe.httpStatus < 200 || probe.httpStatus >= 300)) {
        return `the venue answered /api/status with HTTP ${probe.httpStatus} mid-run, so it is `
            + 'serving errors rather than state. This is the venue, not the wallet.';
    }

    return venueVerdict(probe?.body, coin);
}

/**
 * A watchdog for a poll loop: notices that the venue went away, and refuses to
 * spend the rest of a spec's budget on it.
 *
 * WHY IT TOLERATES THE FIRST FAILURES INSTEAD OF THROWING ON ONE. The outage
 * this exists for healed itself: the container came back on its own
 * (`RestartCount 0`, so a recreate rather than a crash-loop) and a run that
 * aborted on the first missed probe would have thrown away work over a blip.
 * What was actually wrong is that NOTHING EVER NOTICED - the spec waited out
 * its whole budget and then failed on a locator, which reads as a wallet
 * defect. So the rule is: tolerate a gap, then name it.
 *
 * Pure and clock-injected on purpose (`nowMs` is passed in, never read here),
 * so the tolerance window can be driven in a unit test in milliseconds instead
 * of waiting two minutes per case.
 *
 * @param {{toleranceMs?: number}} [opts]
 * @returns {{observe: (probe: object, nowMs: number, coin: string) => string|null}}
 *   `observe` returns null while the venue is healthy OR still inside the
 *   tolerance window, and the sentence once it has been unreachable for longer
 *   than `toleranceMs`. A single healthy probe clears the window.
 */
export function createOutageWatch({ toleranceMs = 120_000 } = {}) {
    let sickSince = null;
    let lastSentence = null;

    return {
        observe(probe, nowMs, coin) {
            const sentence = probeVerdict(probe, coin);
            if (!sentence) {
                // Recovery CLEARS the window rather than decaying it: a venue
                // that answers is a venue that answers, and a half-open window
                // would fail the next spec on the last one's outage.
                sickSince = null;
                lastSentence = null;
                return null;
            }

            if (sickSince === null) {
                sickSince = nowMs;
                lastSentence = sentence;
                return null;
            }
            lastSentence = sentence;

            const downMs = nowMs - sickSince;
            if (downMs < toleranceMs) return null;

            return `${lastSentence} It has been like this for ${Math.round(downMs / 1000)}s, `
                + 'which is longer than a poll should spend on a venue that is not there.';
        },
    };
}
