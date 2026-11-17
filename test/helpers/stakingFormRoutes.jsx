// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The staking routes as the shells open them: each renders the one Staking
// form (StakingForm.jsx) on its target and action, exactly the way the web,
// desktop and extension App.jsx route blocks do. The behaviour tests that
// once mounted the four separate staking forms mount these, so every case
// runs against the merged form with the props a real route passes.

import { StakingForm } from '../../packages/core/src/shared/routes/StakingForm.jsx';

/** stake-form: validator staking, Stake selected. */
export function NetworkStakeRoute({ chainId, ...rest }) {
    return <StakingForm {...rest} target={{ kind: 'network', chainId }} action="stake" />;
}

/** staking-unstake / staking-claim: validator staking, Unstake or Claim selected. */
export function NetworkPositionRoute({ mode, chainId, ...rest }) {
    return <StakingForm {...rest} target={{ kind: 'network', chainId }} action={mode} />;
}

/** staking-delegate / staking-revoke: validator staking, Delegate or Revoke selected. */
export function NetworkDelegationRoute({ mode, chainId, ...rest }) {
    return <StakingForm {...rest} target={{ kind: 'network', chainId }} action={mode} />;
}

/** contract-stake: a contract target, the action preselected by the opening position. */
export function ContractStakeRoute({ chainId, contractActionIndex, initialMode, ...rest }) {
    return (
        <StakingForm
            {...rest}
            target={{ kind: 'contract', chainId, contractActionIndex }}
            action={initialMode || 'stake'}
        />
    );
}
