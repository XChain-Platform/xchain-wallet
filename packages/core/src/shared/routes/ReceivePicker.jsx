// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { TokenPicker } from './TokenPicker.jsx';

/**
 * Receive picker: landing screen for the Receive quick-action. Thin
 * wrapper over the shared {@link TokenPicker} with `purpose="receive"`,
 * which lists every chain the wallet has an address on (even at zero
 * balance) and runs cross-chain "On the platform" token discovery.
 *
 * Selecting a row hands {chainId, tick} to the host so the Receive view
 * opens with the chain pre-selected and (when a token row was chosen) the
 * Token field pre-filled so the QR encodes that asset.
 *
 * Props are forwarded verbatim; `hideOwnFilter` is accepted for backward
 * compatibility but no longer meaningful; the inline toolbar is now the
 * single filter on every shell.
 *
 * @param {import('./TokenPicker.jsx').TokenPicker} props
 */
export function ReceivePicker(props) {
    // eslint-disable-next-line no-unused-vars -- drop legacy prop, forward rest
    const { hideOwnFilter, ...rest } = props;
    return <TokenPicker purpose="receive" {...rest} />;
}
