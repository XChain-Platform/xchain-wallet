// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    AddressIcon,
    ContractIcon,
    GridIcon,
    KeyIcon,
    MintIcon,
    SendIcon,
    StakeIcon,
    SwapIcon,
    TokenIcon,
    TrashIcon,
} from '../../ui/icons/index.jsx';

/**
 * The glyphs of the controller forms' dropdowns (Bind and Unbind Controller):
 * one per subject (token or address) and one per action class, each distinct
 * inside its own list. The two forms share this one map so they never drift.
 */
export const CONTROLLER_TARGET_ICONS = Object.freeze({
    token: <TokenIcon />,
    address: <AddressIcon />,
});

export const CONTROLLER_CLASS_ICONS = Object.freeze({
    transfer: <SendIcon />,
    trade: <SwapIcon />,
    burn: <TrashIcon />,
    mint: <MintIcon />,
    stake: <StakeIcon />,
    ownership: <KeyIcon />,
    all: <GridIcon />,
});

/** The glyph for an action class; a class the SDK adds later gets a contract glyph. */
export function controllerClassIcon(actionClass) {
    return CONTROLLER_CLASS_ICONS[actionClass] || <ContractIcon />;
}
