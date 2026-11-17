// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ListPage } from '@xchain-wallet/core/ui';
import { TokenPicker } from './TokenPicker.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/shell.js';

function ReceiveListPage(props) {
    return <ListPage {...props} />;
}

/**
 * The DEX's Choose Asset page (the `markets-picker` route). Thin wrapper
 * over the shared {@link TokenPicker} with `purpose="receive"`, which lists
 * every chain the wallet has an address on (even at zero balance) and runs
 * cross-chain "On the platform" token discovery, so any asset can scope the
 * markets list, held or not. Receive has no picker page of its own: its
 * Token field opens TokenPicker inside Receive.
 *
 * Selecting a row hands {chainId, tick} to the host, which scopes the
 * markets list to that asset.
 *
 * Props are forwarded verbatim; `hideOwnFilter` is accepted for backward
 * compatibility but no longer meaningful; the filter on the title line is
 * the single filter on every shell.
 *
 * @param {import('./TokenPicker.jsx').TokenPicker} props
 */
export function ReceivePicker(props) {
    // eslint-disable-next-line no-unused-vars -- drop legacy prop, forward rest
    const { hideOwnFilter, ...rest } = props;
    return (
        <TokenPicker
            {...rest}
            title={rest.title ?? t('shell.markets.selectAsset')}
            purpose="receive"
            listPageComponent={ReceiveListPage}
        />
    );
}
