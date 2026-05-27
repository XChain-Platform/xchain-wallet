// Protocol-level ACTION lists used to populate ChainDescriptor.supportedActions.
// Source: xchain-documentation/protocol/actions/. "Supported" here means
// the chain's protocol accepts the action; whether the UI has a native
// authoring surface is a Phase/release concern (see §38 and §43.2).

export const COMMON_ACTIONS = /** @type {const} */ ([
    'AIRDROP',
    'BATCH',
    'BROADCAST',
    'CALLBACK',
    'COINPAY',
    'DESTROY',
    'DISPENSER',
    'DIVIDEND',
    'FILE',
    'ISSUE',
    'LINK',
    'LIST',
    'MESSAGE',
    'MINT',
    'ORDER',
    'PRICE',
    'SEND',
    'SLEEP',
    'SWAP',
    'SWEEP',
]);

// Actions available only on Bitcoin at launch: staking (STAKE/UNSTAKE/
// DELEGATE for rotate+revoke / COLLECT) and smart contracts
// (DEPLOY/EXECUTE/DEPOSIT/WITHDRAW). Per §Phase 4 and SPEC §1.
export const BTC_EXCLUSIVE_ACTIONS = /** @type {const} */ ([
    'COLLECT',
    'DELEGATE',
    'DEPLOY',
    'DEPOSIT',
    'EXECUTE',
    'STAKE',
    'UNSTAKE',
    'WITHDRAW',
]);

export const BITCOIN_ACTIONS = [...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS]
    .slice()
    .sort();
export const LITECOIN_ACTIONS = [...COMMON_ACTIONS].slice().sort();
export const DOGECOIN_ACTIONS = [...COMMON_ACTIONS].slice().sort();
