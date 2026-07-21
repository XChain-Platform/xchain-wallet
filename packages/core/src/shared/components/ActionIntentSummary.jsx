// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ActionIntentSummary ( §5.2.2-3). Renders decoder.describe() of the
// PARSED COMPOSED action string (never form state) plus the txSimulator
// balance deltas. Both consume ONE canonical source - the parsed action -
// so intent and deltas provably agree. Display-hardened by decoder.describe
// upstream; this component is text-only.
//
// The parent computes `decoded` (via sdk.decoder.describe) and `deltas`
// (via txSimulator.simulateAction fed parse() output) and passes them in,
// keeping this component pure and trivially testable.

/**
 * @param {object} props
 * @param {{ summary: string, details: Array<{label: string, value: string}>, warnings: string[] }} props.decoded
 * @param {{ deltas: Array<{ tick: string, before: string, after: string, isCoin?: boolean, isFee?: boolean }>, notes?: string[] } | null} [props.simulation]
 */
export function ActionIntentSummary({ decoded, simulation }) {
    return (
        <div className="action-intent" data-testid="action-intent">
            <p className="action-intent-summary">{decoded.summary}</p>

            {decoded.details.length > 0 ? (
                <dl className="action-intent-details">
                    {decoded.details.map((d, i) => (
                        <div key={`${d.label}-${i}`} className="action-intent-row">
                            <dt>{d.label}</dt>
                            <dd>{d.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}

            {decoded.warnings.length > 0 ? (
                <ul className="action-intent-warnings">
                    {decoded.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
            ) : null}

            {simulation && Array.isArray(simulation.deltas) && simulation.deltas.length > 0 ? (
                <div className="action-intent-deltas" data-testid="action-intent-deltas">
                    {simulation.deltas.map((d, i) => (
                        <div key={`${d.tick}-${i}`} className="action-intent-delta">
                            <span className="delta-tick">{d.tick}</span>
                            <span className="delta-values">{d.before} → {d.after}</span>
                        </div>
                    ))}
                    {Array.isArray(simulation.notes)
                        ? simulation.notes.map((n, i) => (<p key={i} className="delta-note">{n}</p>))
                        : null}
                </div>
            ) : null}
        </div>
    );
}
