// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { IssueTokenForm } from './IssueTokenForm.jsx';

/**
 * The Issue a Token route. Token issuance is the one Issue form, with its
 * Start from presets, so the route only hosts that form.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function TokenWizard({ walletId, onBack }) {
    return <IssueTokenForm walletId={walletId} onBack={onBack} />;
}
