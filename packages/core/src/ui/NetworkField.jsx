// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { ChainPicker } from './ChainPicker.jsx';

/**
 * NetworkField: the standard "which network is this action on" form
 * field. A thin, named wrapper around ChainPicker that pins the house
 * conventions so every form renders the field identically:
 *
 *   - label "Network";
 *   - the wallet's own chains as options (callers pass the chain ids
 *     they operate over, usually every chain the wallet holds
 *     addresses on);
 *   - the testnet/regtest cue kept on (money-moving context).
 *
 * Replaces the older pattern of a bare ChainBadge bubble at the top of
 * a form: a fixed-looking pill that couldn't be opened or changed.
 * Forms whose action is seeded from a specific context (for example a
 * staking position's Claim) still render this field, seeded to that
 * chain, so the user sees and can retarget the network like on any
 * other form.
 *
 * @param {object} props
 * @param {string} props.value                     selected chainId
 * @param {(chainId: string) => void} props.onChange
 * @param {string[]} props.chainIds               chains offered (typically all with addresses)
 * @param {import('../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {string} [props.label]                  defaults to "Network"
 * @param {boolean} [props.disabled]
 * @param {'md' | 'lg'} [props.size]
 */
export function NetworkField({
    value,
    onChange,
    chainIds,
    chainRegistry,
    label = 'Network',
    disabled,
    size = 'md',
}) {
    return (
        <ChainPicker
            label={label}
            value={value}
            onChange={onChange}
            chainIds={chainIds}
            chainRegistry={chainRegistry}
            disabled={disabled}
            size={size}
        />
    );
}
