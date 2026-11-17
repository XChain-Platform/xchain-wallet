// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { pollStatusLabel, pollStatusTone } from './pollDisplay.js';

/**
 * A poll's status pill, shared by the poll list and the poll page so a
 * decided yes/no poll reads Approved or Rejected in both. There is no shared
 * Badge component, so it is a plain span.
 *
 * @param {object} props
 * @param {string | null | undefined} props.status     poll_status
 * @param {string | null | undefined} [props.outcome]  from pollOutcome
 * @param {string} [props.label]                       overrides the label ("Awaiting finalization")
 */
export function PollStatusPill({ status, outcome, label }) {
    const c = pollStatusTone(status, outcome);
    return (
        <span
            data-poll-status=""
            style={{ background: c.bg, color: c.fg, borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
        >
            {label || pollStatusLabel(status, outcome)}
        </span>
    );
}
