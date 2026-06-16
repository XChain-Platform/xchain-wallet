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
 * Send picker — landing screen for the Send quick-action. Thin wrapper
 * over the shared {@link TokenPicker} with `purpose="send"`, which lists
 * only the spendable balances the active wallet/account holds. Selecting a
 * row hands {chainId, tick} to the host so the Send form opens with that
 * asset pre-populated.
 *
 * Props are forwarded verbatim; `hideOwnFilter` is accepted for backward
 * compatibility but no longer meaningful — the inline toolbar is now the
 * single filter on every shell (previously Send filtered via a header
 * popover).
 *
 * @param {import('./TokenPicker.jsx').TokenPicker} props
 */
export function SendPicker(props) {
    // eslint-disable-next-line no-unused-vars -- drop legacy prop, forward rest
    const { hideOwnFilter, ...rest } = props;
    return <TokenPicker purpose="send" {...rest} />;
}
