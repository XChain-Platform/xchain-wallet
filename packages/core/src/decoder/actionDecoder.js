// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-English action decoder. §21.1 / §30.
//
// Translates the raw protocol-shaped action payload (uppercase field
// names, string-encoded amounts) into UI-friendly strings. Pure
// function (no vault, no SDK, no network), so every shell can call it
// synchronously while the user is still typing.
//
// SCOPE,: this is the IN-FORM DRAFT PREVIEW describer, and
// nothing that signs may read it. The confirm surface describes the
// action string the host actually COMPOSED, via `sdk.decoder.describe`
// (confirm-decode-preflight-spec §1.1/§3.2), and the dApp approval
// window describes attacker-supplied params through the same SDK over
// the `action.describe` host route. Two reasons not to reunify them
// here: this copy has no §3.5 display hardening (no bidi/zero-width
// neutralization, no amount flagging). It survives only because a draft
// preview must be synchronous and the React tree holds no SDK - a host
// round trip per keystroke is not a preview. `test/smoke/ui/confirm-
// intent-provenance.smoke.js` holds that boundary.
//
// COVERAGE,: every protocol ACTION, matching the SDK
// describer sentence for sentence. It used to cover 13, so a user
// reviewing a SWAP, STAKE, VOTE, EXECUTE draft (or any of 14 others)
// read "No plain-English summary is available for X yet" plus a warning
// banner on the screen they use to decide whether to sign. The
// describers below the BET decoder are verbatim ports of
// `xchain-sdk/src/decoder/describe.js`, and
// `test/unit/decoder/actionDecoder-coverage.test.js` enumerates the
// action list so a new protocol action cannot quietly reopen the gap.

import { actionDisplayLabel } from '../shared/utils/actionDisplayLabel.js';

/**
 * @typedef {Object} DecodedAction
 * @property {string} summary          one-line plain-English recap
 * @property {Array<{ label: string, value: string }>} details  label/value rows for the sign screen
 * @property {string[]} warnings       red-flag lines the UI must show
 */

/**
 * @param {object} opts
 * @param {string} opts.action
 * @param {Record<string, unknown>} [opts.params]
 * @param {string} [opts.chainId]
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @returns {DecodedAction}
 */
export function decodeAction({ action, params, chainId, chainRegistry }) {
    const p = params || {};
    const descriptor = chainRegistry && chainId ? chainRegistry.get(chainId) : null;
    const chainName = descriptor?.displayName ?? chainId ?? '';
    const chainSuffix = chainName ? ` on ${chainName}` : '';

    if (action === 'SEND') {
        const tick = str(p.TICK);
        const amount = str(p.AMOUNT);
        const dest = str(p.DESTINATION);
        const memo = str(p.MEMO);
        return {
            summary: `Send ${amount || '?'} ${tick || '?'}${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Token', value: tick },
                { label: 'Amount', value: amount },
                { label: 'Destination', value: dest },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(memo && /[|;]/.test(memo)
                    ? ['Memo contains | or ;: the protocol will reject this transaction.']
                    : []),
                ...(!amount || Number(amount) <= 0
                    ? ['Amount is not positive.']
                    : []),
                ...(!dest ? ['Destination is empty.'] : []),
            ],
        };
    }

    if (action === 'SWEEP') {
        const dest = str(p.DESTINATION);
        const memo = str(p.MEMO);
        // SWEEP v0 selective flags: BALANCES/OWNERSHIPS default on, the
        // escrow-closing flags (ORDERS/SWAPS/DISPENSERS) default off.
        const flagOn = (v, dflt) => (v === undefined || v === null || str(v) === '' ? dflt : str(v) === '1');
        const swept = [];
        if (flagOn(p.BALANCES, true)) swept.push('balances');
        if (flagOn(p.OWNERSHIPS, true)) swept.push('ownerships');
        if (flagOn(p.ORDERS, false)) swept.push('open orders');
        if (flagOn(p.SWAPS, false)) swept.push('open swaps');
        if (flagOn(p.DISPENSERS, false)) swept.push('open dispensers');
        const sweptLabel = swept.length ? swept.join(', ') : 'nothing';
        return {
            summary: `Sweep ${sweptLabel}${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Destination', value: dest },
                { label: 'Sweeps', value: sweptLabel },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Sweep moves the selected balances and ownerships from the source address. Double-check the destination.',
                ...(!dest ? ['Destination is empty.'] : []),
            ],
        };
    }

    if (action === 'ISSUE') {
        return decodeIssue(p, chainName, chainSuffix);
    }

    if (action === 'MINT') {
        const tick = str(p.TICK);
        const amount = str(p.AMOUNT);
        const dest = str(p.DESTINATION);
        const memo = str(p.MEMO);
        return {
            summary: `Mint ${amount || '?'} ${tick || '?'}${chainSuffix}${dest ? ` to ${dest}` : ''}`,
            details: [
                { label: 'Token', value: tick },
                { label: 'Amount', value: amount },
                ...(dest ? [{ label: 'Destination', value: dest }] : [{ label: 'Destination', value: 'broadcasting address' }]),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!tick ? ['Token ticker is empty.'] : []),
                ...(!amount || Number(amount) <= 0
                    ? ['Amount is not positive.']
                    : []),
                ...(memo && /[|;]/.test(memo)
                    ? ['Memo contains | or ;: the protocol will reject this transaction.']
                    : []),
            ],
        };
    }

    if (action === 'DESTROY') {
        // Protocol §DESTROY v0 (single) is VERSION|TICK|AMOUNT|MEMO.
        // v1/v2 support multi-destroy (repeating TICK/AMOUNT pairs); the
        // wallet wizard + §40.4 form emit v0 only. Multi-destroy falls
        // through to the generic decoder below and still gets the
        // irreversibility warning because the action kind is DESTROY.
        const version = str(p.VERSION);
        const tick = str(p.TICK);
        const amount = str(p.AMOUNT);
        const memo = str(p.MEMO);
        const isSingle = version === '' || version === '0';
        if (isSingle) {
            return {
                summary: `Destroy ${amount || '?'} ${tick || '?'}${chainSuffix}`,
                details: [
                    { label: 'Token', value: tick },
                    { label: 'Amount', value: amount },
                    ...(memo ? [{ label: 'Memo', value: memo }] : []),
                ],
                warnings: [
                    'Destroying is irreversible. The tokens cannot be recovered.',
                    ...(!tick ? ['Token ticker is empty.'] : []),
                    ...(!amount || Number(amount) <= 0
                        ? ['Amount is not positive.']
                        : []),
                    ...(memo && /[|;]/.test(memo)
                        ? ['Memo contains | or ;: the protocol will reject this transaction.']
                        : []),
                ],
            };
        }
        // Multi-destroy (v1 repeats TICK/AMOUNT, v2 adds a per-leg MEMO).
        // Described leg by leg rather than dropped on the generic
        // path, which showed the protocol's most irreversible action as
        // "no plain-English summary available" the moment it burned more
        // than one token.
        const ticks = toArray(p.TICK);
        const amounts = toArray(p.AMOUNT);
        const memos = toArray(p.MEMO);
        const perLegMemo = version === '2';
        const legCount = Math.max(ticks.length, amounts.length, 1);
        const legs = [];
        for (let i = 0; i < legCount; i += 1) {
            legs.push({
                tick: str(ticks[i] ?? ''),
                amount: str(amounts[i] ?? ''),
                memo: perLegMemo ? str(memos[i] ?? '') : '',
            });
        }
        const sharedMemo = perLegMemo ? '' : memo;
        const anyMemo = sharedMemo || legs.map((l) => l.memo).join('');
        return {
            summary: `Destroy${chainSuffix}: ${legs.map((l) => `${l.amount || '?'} ${l.tick || '?'}`).join(', ')}`,
            details: [
                ...legs.flatMap((l, i) => [
                    { label: `Burn ${i + 1}`, value: `${l.amount || '?'} ${l.tick || '?'}` },
                    ...(l.memo ? [{ label: '  Memo', value: l.memo }] : []),
                ]),
                ...(sharedMemo ? [{ label: 'Memo', value: sharedMemo }] : []),
            ],
            warnings: [
                'Destroying is irreversible. The tokens cannot be recovered.',
                ...(legs.some((l) => !l.tick) ? ['One or more token tickers are empty.'] : []),
                ...(legs.some((l) => !l.amount || Number(l.amount) <= 0)
                    ? ['One or more amounts are not positive.']
                    : []),
                ...(anyMemo && /[|;]/.test(anyMemo)
                    ? ['A memo contains | or ;: the protocol will reject this transaction.']
                    : []),
            ],
        };
    }

    if (action === 'BATCH') {
        return decodeBatch(p, chainId, chainName, chainSuffix, chainRegistry);
    }

    if (action === 'BROADCAST') {
        return decodeBroadcast(p, chainSuffix);
    }

    if (action === 'PRICE') {
        return decodePrice(p, chainSuffix);
    }

    if (action === 'DISPENSER') {
        return decodeDispenser(p, chainSuffix);
    }

    if (action === 'DIVIDEND') {
        return decodeDividend(p, chainSuffix);
    }

    if (action === 'LIST') {
        return decodeList(p, chainSuffix);
    }

    if (action === 'AIRDROP') {
        return decodeAirdrop(p, chainSuffix);
    }

    if (action === 'BET') {
        return decodeBet(p, chainSuffix);
    }

    //Everything below is a verbatim port of the SDK describer
    // (`xchain-sdk/src/decoder/describe.js`), summary text included, so the
    // review stage and the confirm screen say the SAME sentence about the
    // same draft. They previously did not: 18 of the 31 protocol actions
    // reached the review stage as "No plain-English summary is available
    // for X yet" plus a warning banner, which is exactly the wrong thing to
    // show on the surface a user reads to decide whether to sign. If a port
    // and its SDK original ever disagree, the SDK is right - it describes
    // the composed bytes, this describes a draft.
    if (action === 'ADDRESS') return decodeAddress(p, chainSuffix);
    if (action === 'ORDER' || action === 'SWAP') return decodeOrderSwap(action, p, chainSuffix);
    if (action === 'STAKE') return decodeStake(p, chainSuffix);
    if (action === 'UNSTAKE') return decodeUnstake(p, chainSuffix);
    if (action === 'DELEGATE') return decodeDelegate(p, chainSuffix);
    if (action === 'VOTE') return decodeVote(p, chainSuffix);
    if (action === 'DEPLOY') return decodeDeploy(p, chainSuffix);
    if (action === 'EXECUTE') return decodeExecute(p, chainSuffix);
    if (action === 'DEPOSIT' || action === 'WITHDRAW') return decodeContractFunds(action, p, chainSuffix);
    if (action === 'COINPAY') return decodeCoinpay(p, chainSuffix);
    if (action === 'COLLECT') return decodeCollect(p, chainSuffix);
    if (action === 'MESSAGE') return decodeMessage(p, chainSuffix);
    if (action === 'FILE') return decodeFile(p, chainSuffix);
    if (action === 'LINK') return decodeLink(p, chainSuffix);
    if (action === 'SLEEP') return decodeSleep(p, chainSuffix);
    if (action === 'CALLBACK') return decodeCallback(p, chainSuffix);

    return genericFallback(action, p, chainSuffix);
}

/*
 * ADDRESS decoder. v0 sets per-address options (fee disposition,
 * received-SEND memo requirement, who may open a dispenser here); v1
 * binds or unbinds a controller contract for one action class.
 *
 * A blank v0 field is not "off": a blank DISPENSER_PREFERENCE keeps the
 * previous value while a blank FEE_PREFERENCE resets to the default
 * (ADDRESS.md Notes), so the summary lists only what this action changes.
 */
function decodeAddress(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const memo = str(p.MEMO);
    const memoWarnings = memo && /[|;]/.test(memo)
        ? ['Memo contains | or ;: the protocol will reject this transaction.']
        : [];

    if (version === '1') {
        const controller = str(p.CONTROLLER);
        const actionClass = str(p.ACTION_CLASS);
        const cooldown = str(p.COOLDOWN_BLOCKS);
        const unbind = str(p.UNBIND) === '1';
        return {
            summary: unbind
                ? `Unbind controller from this address${actionClass ? ` (${actionClass})` : ''}${chainSuffix}`
                : `Bind this address to controller${controller ? ` #${controller}` : ''}${actionClass ? ` (${actionClass})` : ''}${chainSuffix}`,
            details: [
                ...(controller ? [{ label: 'Controller contract', value: `#${controller}` }] : []),
                ...(actionClass ? [{ label: 'Action class', value: actionClass }] : []),
                ...(cooldown ? [{ label: 'Cooldown blocks', value: cooldown }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                unbind
                    ? 'Unbinding removes the controller policy after the cooldown elapses.'
                    : 'A controller contract will be able to veto or gate this address\'s actions for the bound class. A transfer binding gates BOTH sends from and sends to this address.',
                ...(!unbind && !controller ? ['Controller contract index is empty.'] : []),
                ...(!actionClass ? ['Action class is empty.'] : []),
                ...memoWarnings,
            ],
        };
    }

    const feePref = str(p.FEE_PREFERENCE);
    const requireMemo = str(p.REQUIRE_MEMO);
    const dispenserPref = str(p.DISPENSER_PREFERENCE);

    const feeLabel = feePref === '1' ? 'fees destroyed (lowers supply)'
        : feePref === '2' ? 'fees donated to protocol development'
            : feePref === '0' ? 'fees at the default disposition'
                : '';
    const memoLabel = requireMemo === '1' ? 'a memo required on every incoming send'
        : requireMemo === '0' ? 'no memo required on incoming sends'
            : '';
    const dispenserLabel = dispenserPref === '2' ? 'anyone may open a dispenser on this address'
        : dispenserPref === '1' ? 'only the owner may open a dispenser on this address'
            : '';

    const changes = [feeLabel, memoLabel, dispenserLabel].filter(Boolean);

    return {
        summary: changes.length
            ? `Set address options${chainSuffix}: ${changes.join(', ')}`
            : `Set address options${chainSuffix} (no options changed)`,
        details: [
            ...(feeLabel ? [{ label: 'Fee preference', value: feeLabel }] : []),
            ...(memoLabel ? [{ label: 'Memo requirement', value: memoLabel }] : []),
            ...(dispenserLabel ? [{ label: 'Dispenser preference', value: dispenserLabel }] : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(changes.length === 0
                ? ['This action sets no address options. Every option field is blank.']
                : []),
            ...(feePref !== '' && !['0', '1', '2'].includes(feePref)
                ? ['Fee preference must be 0, 1 or 2: the protocol will reject this transaction.']
                : []),
            ...(feePref === '1'
                ? ['Destroyed fees are burned permanently and cannot be recovered.']
                : []),
            ...(dispenserPref === '2'
                ? ['Anyone will be able to open a dispenser on this address.']
                : []),
            ...memoWarnings,
        ],
    };
}

/*
 * ORDER / SWAP decoder. v0 create, v1 cancel, v2 edit. The two actions
 * share a wire shape; SWAP settles atomically on match while ORDER
 * creates a match obligation settled by COINPAY.
 */
function decodeOrderSwap(action, p, chainSuffix) {
    const noun = action === 'SWAP' ? 'swap' : 'order';
    const properNoun = action === 'SWAP' ? 'Swap' : 'Order';
    const version = str(p.VERSION) || '0';
    const memo = str(p.MEMO);
    const idx = str(p[action === 'SWAP' ? 'SWAP_ACTION_INDEX' : 'ORDER_ACTION_INDEX']);
    const memoWarnings = memo && /[|;]/.test(memo)
        ? ['Memo contains | or ;: the protocol will reject this transaction.'] : [];

    if (version === '1') {
        return {
            summary: `Cancel ${noun}${chainSuffix}${idx ? ` (#${idx})` : ''}`,
            details: [
                ...(idx ? [{ label: `${properNoun} action index`, value: idx }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [...(!idx ? [`${properNoun} action index is empty.`] : []), ...memoWarnings],
        };
    }

    if (version === '2') {
        const expiration = str(p.EXPIRATION);
        const allowList = str(p.ALLOW_LIST);
        const blockList = str(p.BLOCK_LIST);
        return {
            summary: `Edit ${noun}${chainSuffix}${idx ? ` (#${idx})` : ''}`,
            details: [
                ...(idx ? [{ label: `${properNoun} action index`, value: idx }] : []),
                ...(expiration ? [{ label: 'Expiration', value: expiration }] : []),
                ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
                ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [...(!idx ? [`${properNoun} action index is empty.`] : []), ...memoWarnings],
        };
    }

    const giveTick = str(p.GIVE_TICK);
    const giveCoin = str(p.GIVE_COIN);
    const giveAmount = str(p.GIVE_AMOUNT);
    const giveOwnership = str(p.GIVE_OWNERSHIP) === '1';
    const getTick = str(p.GET_TICK);
    const getCoin = str(p.GET_COIN);
    const getAmount = str(p.GET_AMOUNT);
    const getOwnership = str(p.GET_OWNERSHIP) === '1';
    const getAddress = str(p.GET_ADDRESS);
    const expiration = str(p.EXPIRATION);
    const coinLabel = (coin) => (coin ? `${coin} (native coin)` : '');
    const giveLabel = giveOwnership
        ? `ownership of ${giveTick || '?'}`
        : `${giveAmount || '?'} ${giveTick || coinLabel(giveCoin) || '?'}`;
    const getLabel = getOwnership
        ? `ownership of ${getTick || '?'}`
        : `${getAmount || '?'} ${getTick || coinLabel(getCoin) || '?'}`;
    return {
        summary: `Create ${noun}${chainSuffix}: give ${giveLabel} for ${getLabel}`,
        details: [
            { label: 'Give', value: giveLabel },
            { label: 'Get', value: getLabel },
            ...(getAddress ? [{ label: 'Counterparty', value: getAddress }] : []),
            ...(expiration ? [{ label: 'Expiration', value: expiration }] : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(!giveOwnership && (!giveAmount || Number(giveAmount) <= 0)
                ? ['Give amount is not positive.'] : []),
            ...(!getOwnership && (!getAmount || Number(getAmount) <= 0)
                ? ['Get amount is not positive.'] : []),
            ...memoWarnings,
        ],
    };
}

/*
 * STAKE decoder. v1 new capability stake, v2 top-up, v3
 * contract-targeted. The version IS the semantics (v1/v2 share a wire
 * shape), so it is always named.
 */
function decodeStake(p, chainSuffix) {
    const version = str(p.VERSION) || '1';
    const amount = str(p.AMOUNT);
    const pubkey = str(p.SIGNING_PUBKEY);
    const target = str(p.TARGET_CONTRACT_INDEX);
    const tick = str(p.TICK);
    const kind = version === '3'
        ? `to contract${target ? ` #${target}` : ''}`
        : version === '2' ? '(top-up)' : '(new validator stake)';
    return {
        summary: `Stake ${amount || '?'}${version === '3' && tick ? ` ${tick}` : ''}${chainSuffix} ${kind}`,
        details: [
            { label: 'Amount', value: amount },
            ...(version === '3' && tick ? [{ label: 'Token', value: tick }] : []),
            ...(target ? [{ label: 'Target contract', value: `#${target}` }] : []),
            { label: 'Signing public key', value: pubkey },
        ],
        warnings: [
            ...(!amount || Number(amount) <= 0 ? ['Stake amount is not positive.'] : []),
            ...(!pubkey ? ['Signing public key is empty.'] : []),
            'Staked funds are locked until unstake plus the cooldown period.',
        ],
    };
}

/* UNSTAKE decoder. v0 capability, v1 contract-targeted. */
function decodeUnstake(p, chainSuffix) {
    const target = str(p.TARGET_CONTRACT_INDEX);
    const tick = str(p.TICK);
    const pubkey = str(p.SIGNING_PUBKEY);
    return {
        summary: `Unstake${tick ? ` ${tick}` : ''}${target ? ` from contract #${target}` : ''}${chainSuffix}`,
        details: [
            ...(tick ? [{ label: 'Token', value: tick }] : []),
            ...(target ? [{ label: 'Target contract', value: `#${target}` }] : []),
            { label: 'Signing public key', value: pubkey },
        ],
        warnings: [
            ...(!pubkey ? ['Signing public key is empty.'] : []),
            'Unstaked funds enter a cooldown before they are spendable.',
        ],
    };
}

/*
 * DELEGATE decoder: validator signing-key rotation (v0/v1 rotate, v2/v3
 * revoke), NOT poll vote delegation (that is VOTE v3).
 */
function decodeDelegate(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const isRevoke = version === '2' || version === '3';
    const newKey = str(p.NEW_SIGNING_PUBKEY);
    const key = str(p.SIGNING_PUBKEY);
    const target = str(p.TARGET_CONTRACT_INDEX);
    const tick = str(p.TICK);
    return {
        summary: isRevoke
            ? `Revoke validator signing key${target ? ` for contract #${target}` : ''}${chainSuffix}`
            : `Rotate validator signing key${target ? ` for contract #${target}` : ''}${chainSuffix}`,
        details: [
            ...(isRevoke
                ? [{ label: 'Signing public key', value: key }]
                : [{ label: 'New signing public key', value: newKey }]),
            ...(target ? [{ label: 'Target contract', value: `#${target}` }] : []),
            ...(tick ? [{ label: 'Token', value: tick }] : []),
        ],
        warnings: [
            ...((isRevoke ? !key : !newKey) ? ['Signing public key is empty.'] : []),
            'This changes which key signs for your stake. Verify the key belongs to you.',
        ],
    };
}

/*
 * VOTE decoder: token-weighted governance. v0 create poll, v1 cast
 * ballot, v3 delegate standing vote (v2 finalize is system-only).
 */
function decodeVote(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const memo = str(p.MEMO);
    if (version === '1') {
        const pollRef = str(p.POLL_REF);
        const ballot = str(p.BALLOT);
        return {
            summary: `Cast ballot "${ballot || '?'}" on poll${pollRef ? ` #${pollRef}` : ''}${chainSuffix}`,
            details: [
                { label: 'Poll', value: pollRef ? `#${pollRef}` : '' },
                { label: 'Ballot', value: ballot },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!pollRef ? ['Poll reference is empty.'] : []),
                ...(!ballot ? ['Ballot is empty.'] : []),
                'A later ballot on the same poll overwrites this one.',
            ],
        };
    }
    if (version === '3') {
        const tick = str(p.TICK);
        const delegateTo = str(p.DELEGATE_TO);
        return {
            summary: delegateTo
                ? `Delegate ${tick || '?'} voting power to ${delegateTo}${chainSuffix}`
                : `Clear ${tick || '?'} vote delegation${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                ...(delegateTo ? [{ label: 'Delegate to', value: delegateTo }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: delegateTo
                ? ['The delegate votes with your token weight until you clear the delegation.']
                : [],
        };
    }
    const tick = str(p.TICK);
    const endBlock = str(p.END_BLOCK);
    const question = str(p.QUESTION);
    const options = str(p.OPTIONS);
    return {
        summary: `Create poll for ${tick || '?'} holders${chainSuffix}${question ? `: ${question}` : ''}`,
        details: [
            { label: 'Token', value: tick },
            ...(question ? [{ label: 'Question', value: question }] : []),
            ...(options ? [{ label: 'Options', value: options }] : []),
            ...(endBlock ? [{ label: 'End block', value: endBlock }] : []),
        ],
        warnings: [
            ...(!tick ? ['Token ticker is empty.'] : []),
            ...(!endBlock ? ['End block is empty.'] : []),
        ],
    };
}

/*
 * DEPLOY decoder. v0/v1 inline source (CODE_ENCODING = base64), v2/v3
 * chunked assembly by CODE_HASH, v4 chunk carrier.
 */
function decodeDeploy(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const gasLimit = str(p.GAS_LIMIT);
    if (version === '4') {
        const idx = str(p.CHUNK_INDEX);
        const total = str(p.TOTAL_CHUNKS);
        return {
            summary: `Upload contract code chunk ${idx || '?'} of ${total || '?'}${chainSuffix}`,
            details: [
                { label: 'Chunk', value: `${idx || '?'} / ${total || '?'}` },
                { label: 'Code hash', value: str(p.CODE_HASH) },
            ],
            warnings: [],
        };
    }
    const chunked = version === '2' || version === '3';
    const stakeable = version === '1' || version === '3';
    const codeLen = str(p.CODE_ENCODING).length;
    return {
        summary: `Deploy ${stakeable ? 'stakeable ' : ''}smart contract${chainSuffix}${chunked ? ' (from uploaded chunks)' : ''}`,
        details: [
            ...(chunked
                ? [{ label: 'Code hash', value: str(p.CODE_HASH) }]
                : [{ label: 'Code size (base64)', value: String(codeLen) }]),
            ...(gasLimit ? [{ label: 'Gas limit', value: gasLimit }] : []),
            ...(stakeable && str(p.COOLDOWN_BLOCKS) ? [{ label: 'Cooldown blocks', value: str(p.COOLDOWN_BLOCKS) }] : []),
            ...(stakeable && str(p.SLASH_DESTINATION) ? [{ label: 'Slash destination', value: str(p.SLASH_DESTINATION) }] : []),
        ],
        warnings: [
            'Deployed contract code is immutable and its constructor runs once at deploy.',
            ...(!gasLimit ? ['Gas limit is empty.'] : []),
        ],
    };
}

/* EXECUTE decoder: call a deployed contract method (gas is the fee). */
function decodeExecute(p, chainSuffix) {
    const idx = str(p.CONTRACT_ACTION_INDEX);
    const method = str(p.METHOD);
    const params = toArray(p.PARAMS);
    return {
        summary: `Call ${method || '?'}() on contract${idx ? ` #${idx}` : ''}${chainSuffix}`,
        details: [
            { label: 'Contract', value: idx ? `#${idx}` : '' },
            { label: 'Method', value: method },
            ...(params.length ? [{ label: 'Arguments', value: params.join(', ') }] : []),
        ],
        warnings: [
            ...(!idx ? ['Contract action index is empty.'] : []),
            ...(!method ? ['Method name is empty.'] : []),
            'Gas is charged even if the contract call fails at runtime.',
        ],
    };
}

/* DEPOSIT / WITHDRAW decoder: move tokens into/out of a contract. */
function decodeContractFunds(action, p, chainSuffix) {
    const idx = str(p.CONTRACT_ACTION_INDEX);
    const tick = str(p.TICK);
    const qty = str(p.QUANTITY);
    const verb = action === 'DEPOSIT' ? 'Deposit' : 'Withdraw';
    const prep = action === 'DEPOSIT' ? 'into' : 'from';
    return {
        summary: `${verb} ${qty || '?'} ${tick || '?'} ${prep} contract${idx ? ` #${idx}` : ''}${chainSuffix}`,
        details: [
            { label: 'Contract', value: idx ? `#${idx}` : '' },
            { label: 'Token', value: tick },
            { label: 'Amount', value: qty },
        ],
        warnings: [
            ...(!idx ? ['Contract action index is empty.'] : []),
            ...(!qty || Number(qty) <= 0 ? ['Amount is not positive.'] : []),
            ...(action === 'WITHDRAW' ? ['Only the contract deployer can withdraw contract credit.'] : []),
        ],
    };
}

/* COINPAY decoder: settle a matched order with native coin. */
function decodeCoinpay(p, chainSuffix) {
    const idx = str(p.ORDER_MATCH_ACTION_INDEX);
    return {
        summary: `Pay native coin to settle order match${idx ? ` #${idx}` : ''}${chainSuffix}`,
        details: [{ label: 'Order match', value: idx ? `#${idx}` : '' }],
        warnings: [
            ...(!idx ? ['Order match action index is empty.'] : []),
            'This transaction moves native coin to the order counterparty.',
        ],
    };
}

/* COLLECT decoder: claim accrued validator rewards. */
function decodeCollect(p, chainSuffix) {
    return {
        summary: `Collect validator rewards${chainSuffix}`,
        details: [],
        warnings: [],
    };
}

/*
 * MESSAGE decoder. v0/v1 key exchange, v2 encrypted payload, v3
 * plaintext. Encrypted bodies are unreadable by design; say so rather
 * than render ciphertext.
 */
function decodeMessage(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const dest = str(p.DESTINATION);
    const coin = str(p.COIN);
    if (version === '3') {
        const text = str(p.PLAINTEXT_MESSAGE);
        return {
            summary: `Send public message to ${dest || '?'}${chainSuffix}`,
            details: [
                { label: 'To', value: dest },
                ...(coin ? [{ label: 'Chain', value: coin }] : []),
                { label: 'Message', value: text },
            ],
            warnings: ['This message is PUBLIC and permanent on the blockchain.'],
        };
    }
    if (version === '2') {
        return {
            summary: `Send encrypted message to ${dest || '?'}${chainSuffix}`,
            details: [
                { label: 'To', value: dest },
                ...(coin ? [{ label: 'Chain', value: coin }] : []),
                { label: 'Body', value: '(encrypted)' },
            ],
            warnings: [...(!dest ? ['Destination is empty.'] : [])],
        };
    }
    return {
        summary: `Publish messaging key for ${dest || '?'}${chainSuffix}`,
        details: [
            { label: 'Address', value: dest },
            ...(str(p.ENCRYPTION_METHOD) ? [{ label: 'Encryption method', value: str(p.ENCRYPTION_METHOD) }] : []),
        ],
        warnings: [],
    };
}

/* FILE decoder: publish a (possibly gated) file record. */
function decodeFile(p, chainSuffix) {
    const name = str(p.NAME);
    const type = str(p.TYPE);
    const title = str(p.TITLE);
    const gate = str(p.GATE_TICKER);
    return {
        summary: `Publish file ${name || '?'}${chainSuffix}${gate ? ` (gated by ${gate})` : ''}`,
        details: [
            { label: 'Name', value: name },
            { label: 'Type', value: type },
            ...(title ? [{ label: 'Title', value: title }] : []),
            ...(gate ? [{ label: 'Gate token', value: gate }] : []),
            ...(str(p.ENCRYPTION_METHOD) ? [{ label: 'Encryption', value: str(p.ENCRYPTION_METHOD) }] : []),
        ],
        warnings: [
            ...(!name ? ['File name is empty.'] : []),
            'File contents are permanent and public on the blockchain (encrypted if gated).',
        ],
    };
}

/* LINK decoder: bind two actions across chains. */
function decodeLink(p, chainSuffix) {
    const coin1 = str(p.COIN1);
    const idx1 = str(p.COIN1_ACTION_INDEX);
    const coin2 = str(p.COIN2);
    const idx2 = str(p.COIN2_ACTION_INDEX);
    return {
        summary: `Link ${coin1 || '?'} action #${idx1 || '?'} to ${coin2 || '?'} action #${idx2 || '?'}${chainSuffix}`,
        details: [
            { label: 'Chain 1', value: coin1 },
            { label: 'Action 1', value: idx1 ? `#${idx1}` : '' },
            { label: 'Chain 2', value: coin2 },
            { label: 'Action 2', value: idx2 ? `#${idx2}` : '' },
        ],
        warnings: [
            ...(!coin1 || !coin2 ? ['Both chains must be specified.'] : []),
        ],
    };
}

/* SLEEP decoder: pause a token until a resume block. */
function decodeSleep(p, chainSuffix) {
    const resumeBlock = str(p.RESUME_BLOCK);
    const tick = str(p.TICK);
    return {
        summary: `Pause ${tick || 'token activity'}${chainSuffix} until block ${resumeBlock || '?'}`,
        details: [
            ...(tick ? [{ label: 'Token', value: tick }] : []),
            { label: 'Resume block', value: resumeBlock },
        ],
        warnings: [
            'While asleep, transfers of the affected token are rejected.',
            ...(!resumeBlock ? ['Resume block is empty.'] : []),
        ],
    };
}

/* CALLBACK decoder: force-redeem a token per its callback terms. */
function decodeCallback(p, chainSuffix) {
    const tick = str(p.TICK);
    return {
        summary: `Trigger callback redemption of ${tick || '?'}${chainSuffix}`,
        details: [{ label: 'Token', value: tick }],
        warnings: [
            'Callback redeems ALL holders\' tokens at the configured callback terms. This cannot be undone.',
            ...(!tick ? ['Token ticker is empty.'] : []),
        ],
    };
}

/**
 * BET decoder (§11.3 signing). One action name over four formats, so the
 * summary must name WHICH one is being signed: approving a resolve is not
 * remotely the same act as approving a stake.
 *
 * Reads the SDK builder's own camelCase output (what the host composes and hands
 * to the confirm page), and tolerates the uppercase wire spelling so a pasted or
 * imported raw action still reads sensibly.
 *
 * The warnings are the irreversibilities, not lint. A bet cannot be cancelled, a
 * resolve is the payout decision itself, and a cancel refunds and ends the
 * market. Those are the facts a signer needs before approving, and they are
 * exactly what a raw-hex confirm screen would hide.
 */
function decodeBet(p, chainSuffix) {
    const pick = (camel, upper) => {
        const a = p[camel];
        if (a !== undefined && a !== null && a !== '') return str(a);
        const b = p[upper];
        return (b === undefined || b === null) ? '' : str(b);
    };

    const version = pick('version', 'VERSION');
    const feedRef = pick('feedActionIndex', 'FEED_ACTION_INDEX');
    const outcome = pick('outcome', 'OUTCOME');
    const memo = pick('memo', 'MEMO');
    const memoWarn = memo && /[|;]/.test(memo)
        ? ['Memo contains | or ;: the protocol will reject this transaction.']
        : [];

    // v2 place a bet
    if (version === '2') {
        const amount = pick('amount', 'AMOUNT');
        return {
            summary: `Bet ${amount || '?'} on outcome ${outcome || '?'} of market ${feedRef || '?'}${chainSuffix}`,
            details: [
                { label: 'Market', value: feedRef },
                { label: 'Outcome', value: outcome },
                { label: 'Stake', value: amount },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Bets are final. There is no cancel and no way to change your outcome once this is signed.',
                'This is a parimutuel market, so your share is not fixed now: later bets change what a win pays.',
                ...(!amount || Number(amount) <= 0 ? ['Stake is not positive.'] : []),
                ...memoWarn,
            ],
        };
    }

    // v3 resolve a market
    if (version === '3') {
        return {
            summary: `Resolve market ${feedRef || '?'} to outcome ${outcome || '?'}${chainSuffix}`,
            details: [
                { label: 'Market', value: feedRef },
                { label: 'Winning outcome', value: outcome },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'This pays out the market. Everyone backing this outcome splits the pot, everyone else loses their stake.',
                'Resolving cannot be undone or corrected afterwards.',
                ...memoWarn,
            ],
        };
    }

    // v1 cancel a market
    if (version === '1') {
        return {
            summary: `Cancel market ${feedRef || '?'} and refund every bet${chainSuffix}`,
            details: [
                { label: 'Market', value: feedRef },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Every open bet is refunded in full and the market is over. This cannot be undone.',
                ...memoWarn,
            ],
        };
    }

    // v0 create a market (also the fallback when VERSION is absent, since the
    // create format is the only one carrying a label).
    const label = pick('label', 'LABEL');
    const outcomes = pick('outcomes', 'OUTCOMES');
    const tick = pick('tick', 'TICK');
    const fee = pick('fee', 'FEE');
    const deadline = pick('deadline', 'DEADLINE');
    const refundWindow = pick('refundWindow', 'REFUND_WINDOW');
    const minAmount = pick('minAmount', 'MIN_AMOUNT');
    const allowList = pick('allowList', 'ALLOW_LIST');
    const blockList = pick('blockList', 'BLOCK_LIST');
    const outcomeList = outcomes ? outcomes.split(',') : [];

    return {
        summary: `Open a betting market on ${tick || '?'}${chainSuffix}: ${label || '(untitled)'}`,
        details: [
            { label: 'Market', value: label },
            { label: 'Outcomes', value: outcomeList.join(' / ') },
            { label: 'Wager token', value: tick },
            // Named to keep it distinct from the protocol's market duration fee,
            // which is a different charge paid to a different party.
            { label: 'Oracle fee (percent of pot)', value: fee ? `${fee}%` : '0%' },
            { label: 'Betting closes', value: deadline },
            { label: 'Refund window (seconds)', value: refundWindow },
            ...(minAmount ? [{ label: 'Minimum bet', value: minAmount }] : []),
            ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
            ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            'Markets cannot be edited after this. To change any term you must cancel and create a new one.',
            'You are the oracle: if you never resolve it, bettors are refunded after the refund window, and your address carries that record publicly.',
            ...(outcomeList.length < 2 ? ['A market needs at least two outcomes.'] : []),
            ...memoWarn,
        ],
    };
}

/**
 * LIST decoder. §40.9 / LIST.md. Two format versions:
 *
 *   - v0 Create: VERSION|TYPE|ITEM (ITEM repeats). TYPE 1 = TICK list,
 *     TYPE 2 = ADDRESS list. The wallet's AIRDROP authoring flow emits
 *     v0 with TYPE=2 (address pool).
 *   - v1 Edit: VERSION|EDIT|LIST_ACTION_INDEX|ITEM (ITEM repeats).
 *     Clones an existing list and adds (EDIT=1) or removes (EDIT=2)
 *     the listed items. No authoring UI in Step 24, but the decoder
 *     case lands so imports / pasted raw actions read sensibly.
 */
function decodeList(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const items = toArray(p.ITEM);
    const count = items.length;

    if (version === '1') {
        const edit = str(p.EDIT);
        const parent = str(p.LIST_ACTION_INDEX);
        const verb = edit === '1' ? 'Add' : edit === '2' ? 'Remove' : 'Edit';
        const prep = edit === '2' ? 'from' : 'to';
        const summary = `${verb} ${count || '?'} item${count === 1 ? '' : 's'} ${prep} list${parent ? ` #${parent}` : ''}${chainSuffix}`;
        return {
            summary,
            details: [
                { label: 'Edit', value: edit === '1' ? 'Add' : edit === '2' ? 'Remove' : edit },
                ...(parent ? [{ label: 'Parent list action index', value: parent }] : []),
                { label: 'Items', value: String(count) },
                ...(count > 0 && count <= 5
                    ? [{ label: 'Sample', value: items.join(', ') }]
                    : []),
            ],
            warnings: [
                ...(!edit ? ['Edit direction is empty. Specify whether to add or remove items.'] : []),
                ...(!parent ? ['Parent list action index is empty.'] : []),
                ...(count === 0 ? ['List has no items.'] : []),
            ],
        };
    }

    // Version 0: create.
    const type = str(p.TYPE);
    const kind = type === '1' ? 'token' : type === '2' ? 'address' : 'item';
    const summary = `Create ${kind} list of ${count || '?'} item${count === 1 ? '' : 's'}${chainSuffix}`;
    return {
        summary,
        details: [
            { label: 'Type', value: type === '1' ? 'Token' : type === '2' ? 'Address' : type },
            { label: 'Items', value: String(count) },
            ...(count > 0 && count <= 5
                ? [{ label: 'Sample', value: items.join(', ') }]
                : []),
        ],
        warnings: [
            ...(!type ? ['List type is empty. Specify a token list or an address list.'] : []),
            ...(count === 0 ? ['List has no items.'] : []),
        ],
    };
}

/**
 * AIRDROP decoder. §40.9 / AIRDROP.md. Four format versions:
 *
 *   - v0 Single: one TICK, one AMOUNT, one LIST_ACTION_INDEX, MEMO.
 *     The wallet's §40.9 two-tx flow emits v0; the prior LIST action's
 *     ACTION_INDEX is resolved after indexing and baked in here.
 *   - v1 Multi-token, single list: repeating TICK/AMOUNT pairs to one
 *     LIST_ACTION_INDEX.
 *   - v2 Multi-token, multi-list: repeating TICK/AMOUNT/LIST triples.
 *   - v3 Same as v2 plus per-tuple MEMO.
 *
 * The decoder cannot know whether the referenced LIST is a TICK list
 * (airdrop to holders of each ticker) or an ADDRESS list (airdrop to
 * each address) without a DB lookup, so the summary stays neutral.
 */
function decodeAirdrop(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const memo = str(p.MEMO);
    const memoArr = toArray(p.MEMO);
    const memoWarning = memo && /[|;]/.test(memo)
        ? ['Memo contains | or ;: the protocol will reject this transaction.']
        : memoArr.some((m) => /[|;]/.test(String(m)))
            ? ['A memo contains | or ;: the protocol will reject this transaction.']
            : [];

    if (version === '0') {
        const tick = str(p.TICK);
        const amount = str(p.AMOUNT);
        const listIdx = str(p.LIST_ACTION_INDEX);
        return {
            summary: `Airdrop ${amount || '?'} ${tick || '?'}${chainSuffix} to list${listIdx ? ` #${listIdx}` : ''}`,
            details: [
                { label: 'Token', value: tick },
                { label: 'Per-recipient amount', value: amount },
                { label: 'List action index', value: listIdx ? `#${listIdx}` : '' },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!tick ? ['Token ticker is empty.'] : []),
                ...(!amount || Number(amount) <= 0
                    ? ['Per-recipient amount is not positive.']
                    : []),
                ...(!listIdx ? ['List action index is empty.'] : []),
                ...memoWarning,
            ],
        };
    }

    // Multi-airdrop variants (v1 / v2 / v3). Fields arrive as arrays
    // when the SDK serializes repeating slots.
    const ticks = toArray(p.TICK);
    const amounts = toArray(p.AMOUNT);
    const lists = toArray(p.LIST_ACTION_INDEX);
    const n = Math.max(ticks.length, amounts.length, 1);

    const drops = [];
    for (let i = 0; i < n; i += 1) {
        const t = str(ticks[i] ?? '');
        const a = str(amounts[i] ?? '');
        // v1 reuses a single LIST_ACTION_INDEX across all TICK/AMOUNT
        // pairs; v2/v3 carry one per tuple.
        const li = version === '1'
            ? str(lists[0] ?? '')
            : str(lists[i] ?? '');
        const m = version === '3' ? str(memoArr[i] ?? '') : '';
        drops.push({ tick: t, amount: a, list: li, memo: m });
    }

    const summaryLine = drops
        .map((d) => `${d.amount || '?'} ${d.tick || '?'} → list${d.list ? ` #${d.list}` : ''}`)
        .join(', ');
    const summary = `Airdrop${chainSuffix}: ${summaryLine}`;

    const details = drops.flatMap((d, i) => [
        { label: `Drop ${i + 1}`, value: `${d.amount || '?'} ${d.tick || '?'} to list${d.list ? ` #${d.list}` : ''}` },
        ...(d.memo ? [{ label: `  Memo`, value: d.memo }] : []),
    ]);
    if (memo && version !== '3') details.push({ label: 'Memo', value: memo });

    const warnings = [
        ...(drops.some((d) => !d.tick) ? ['One or more token tickers are empty.'] : []),
        ...(drops.some((d) => !d.amount || Number(d.amount) <= 0)
            ? ['One or more per-recipient amounts are not positive.']
            : []),
        ...(drops.some((d) => !d.list) ? ['One or more list action indexes are empty.'] : []),
        ...memoWarning,
    ];

    return { summary, details, warnings };
}

/**
 * DIVIDEND decoder. §40.8. DIVIDEND.md has a single format version
 * `VERSION|TICK|DIVIDEND_TICK|AMOUNT|MEMO`. The action pays AMOUNT of
 * DIVIDEND_TICK per unit of TICK held at the snapshot block. Source
 * address is excluded from receiving dividends (§40.8 / DIVIDEND.md
 * Rules). The decoder cannot fetch holder count itself; the form
 * adds that preview at render time.
 */
function decodeDividend(p, chainSuffix) {
    const tick = str(p.TICK);
    const dividendTick = str(p.DIVIDEND_TICK);
    const amount = str(p.AMOUNT);
    const memo = str(p.MEMO);
    return {
        summary: `Pay ${amount || '?'} ${dividendTick || '?'} per unit of ${tick || '?'}${chainSuffix}`,
        details: [
            { label: 'Holders of', value: tick },
            { label: 'Receive', value: dividendTick },
            { label: 'Per-unit amount', value: amount },
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(!tick ? ['Holder ticker is empty.'] : []),
            ...(!dividendTick ? ['Dividend ticker is empty.'] : []),
            ...(!amount || Number(amount) <= 0
                ? ['Per-unit amount is not positive.']
                : []),
            ...(memo && /[|;]/.test(memo)
                ? ['Memo contains | or ;: the protocol will reject this transaction.']
                : []),
        ],
    };
}

/**
 * DISPENSER decoder. §40.7. Three format versions (DISPENSER.md):
 *
 *   - v0 Create: open a new dispenser. The form can emit either a
 *     coin-paid lane (GET_COIN set, GET_TICK empty; buyer pays in the
 *     native coin) or a token-paid lane (GET_TICK set, GET_COIN empty).
 *     FIAT dispensers (FIAT_CODE + FIAT_AMOUNT, or ORACLE_ADDRESS) get
 *     their own summary line so the user sees the pricing mode before
 *     signing.
 *   - v1 Cancel: closes an existing dispenser; the v1 decoder is
 *     reached from the dispenser-detail "Close" path.
 *   - v2 Edit: refills escrow, updates expiration / lists.
 */
function decodeDispenser(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const memo = str(p.MEMO);
    const baseWarnings = [
        ...(memo && /[|;]/.test(memo)
            ? ['Memo contains | or ;: the protocol will reject this transaction.']
            : []),
    ];

    if (version === '1') {
        // Cancel
        const idx = str(p.DISPENSER_ACTION_INDEX);
        return {
            summary: `Cancel dispenser${chainSuffix}${idx ? ` (#${idx})` : ''}`,
            details: [
                ...(idx ? [{ label: 'Dispenser action index', value: idx }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Cancelling a dispenser returns the remaining escrow to the owner after a 1-hour close window.',
                ...(!idx ? ['Dispenser action index is empty.'] : []),
                ...baseWarnings,
            ],
        };
    }

    if (version === '2') {
        // Edit
        const idx = str(p.DISPENSER_ACTION_INDEX);
        const giveEscrow = str(p.GIVE_ESCROW);
        const expiration = str(p.EXPIRATION);
        const allowList = str(p.ALLOW_LIST);
        const blockList = str(p.BLOCK_LIST);
        return {
            summary: `Edit dispenser${chainSuffix}${idx ? ` (#${idx})` : ''}`,
            details: [
                ...(idx ? [{ label: 'Dispenser action index', value: idx }] : []),
                ...(giveEscrow ? [{ label: 'Refill escrow by', value: giveEscrow }] : []),
                ...(expiration ? [{ label: 'Expiration (unix)', value: expiration }] : []),
                ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
                ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!idx ? ['Dispenser action index is empty.'] : []),
                'Allow/block list changes take effect after a 1-hour delay.',
                ...baseWarnings,
            ],
        };
    }

    // Version 0: create.
    const giveCoin = str(p.GIVE_COIN);
    const giveTick = str(p.GIVE_TICK);
    const giveAmount = str(p.GIVE_AMOUNT);
    const giveEscrow = str(p.GIVE_ESCROW);
    const getCoin = str(p.GET_COIN);
    const getTick = str(p.GET_TICK);
    const getAmount = str(p.GET_AMOUNT);
    const getAddress = str(p.GET_ADDRESS);
    const fiatCode = str(p.FIAT_CODE);
    const fiatAmount = str(p.FIAT_AMOUNT);
    const oracle = str(p.ORACLE_ADDRESS);
    const expiration = str(p.EXPIRATION);
    const allowList = str(p.ALLOW_LIST);
    const blockList = str(p.BLOCK_LIST);

    // Pricing lane: determines how the one-liner reads.
    const payPriceLabel = oracle
        ? `an oracle-priced ${fiatCode || 'fiat'} amount`
        : fiatAmount && fiatCode
            ? `${fiatAmount} ${fiatCode}`
            : getTick
                ? `${getAmount || '?'} ${getTick}`
                : `${getAmount || '?'} ${getCoin || '?'}`;

    const fillsEstimate = giveAmount && giveEscrow && Number(giveAmount) > 0
        ? Math.floor(Number(giveEscrow) / Number(giveAmount))
        : null;

    const summary = `Create dispenser${chainSuffix}: lock ${giveEscrow || '?'} ${giveTick || '?'}, give ${giveAmount || '?'} ${giveTick || '?'} per ${payPriceLabel}`;

    const details = [
        { label: 'Token (give)', value: giveTick },
        ...(giveCoin ? [{ label: 'Token chain', value: giveCoin }] : []),
        ...(giveAmount ? [{ label: 'Per-fill amount', value: giveAmount }] : []),
        ...(giveEscrow ? [{ label: 'Escrow (locked)', value: giveEscrow }] : []),
        ...(fillsEstimate !== null ? [{ label: 'Estimated fills', value: String(fillsEstimate) }] : []),
        ...(getAmount ? [{ label: 'Trigger amount', value: getAmount }] : []),
        ...(getTick ? [{ label: 'Buyer pays (token)', value: getTick }] : []),
        ...(!getTick && getCoin ? [{ label: 'Buyer pays (coin)', value: getCoin }] : []),
        ...(fiatCode ? [{ label: 'Priced in', value: fiatCode }] : []),
        ...(fiatAmount ? [{ label: 'Fiat amount', value: fiatAmount }] : []),
        ...(oracle ? [{ label: 'Oracle address', value: oracle }] : []),
        ...(getAddress ? [{ label: 'Dispenser address', value: getAddress }] : []),
        ...(expiration ? [{ label: 'Expiration (unix)', value: expiration }] : []),
        ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
        ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
        ...(memo ? [{ label: 'Memo', value: memo }] : []),
    ];

    const warnings = [
        ...(!giveTick ? ['Give-token ticker is empty.'] : []),
        ...(!giveAmount || Number(giveAmount) <= 0
            ? ['Per-fill amount is not positive.']
            : []),
        ...(!giveEscrow || Number(giveEscrow) <= 0
            ? ['Escrow amount is not positive.']
            : []),
        ...(giveAmount && giveEscrow && Number(giveEscrow) < Number(giveAmount)
            ? ['Escrow is smaller than a single fill, so the dispenser will never dispense.']
            : []),
        ...(!getAmount ? ['Trigger amount is empty.'] : []),
        ...(!getTick && !getCoin
            ? ['Buyer payment is ambiguous. Set either a token or a coin for the buyer to pay.']
            : []),
        ...(oracle && !fiatCode
            ? ['Oracle pricing requires a fiat currency. The oracle publishes token prices in that fiat.']
            : []),
        ...baseWarnings,
    ];

    return { summary, details, warnings };
}

/**
 * PRICE decoder (PC-30). PRICE.md defines two versions and only one of
 * them is authorable here: v0 is the validator federation's COIN/FIAT
 * snapshot, PBFT-broadcast and not user-encodable, so a v0 reaching this
 * decoder came from a pasted or imported action and is flagged rather
 * than summarized as something the user can sign.
 *
 * v1 is the permissionless user oracle: VERSION|COIN|TICK|FIAT|VALUE|FEE|MEMO.
 * Two warnings ride on every v1 because they are the two things that
 * surprise publishers, and both are properties of the protocol rather
 * than of this particular publish (see flows/oracleQueries.js):
 * the quote is inert for 24h and cannot be retracted in that window, and
 * dispensers pointing at this address will settle real money against it.
 *
 * Note this is NOT the legacy BROADCAST v1/v2 "oracle" lane, which is a
 * free-text feed with a percentage fee. They share the word and nothing
 * else: only a PRICE v1 row can price a Mode B dispenser.
 */
function decodePrice(p, chainSuffix) {
    const version = str(p.VERSION) || '1';
    const coin = str(p.COIN).toUpperCase();
    const tick = str(p.TICK).toUpperCase();
    const fiat = str(p.FIAT).toUpperCase();
    const value = str(p.VALUE);
    const fee = str(p.FEE);
    const memo = str(p.MEMO);

    if (version === '0') {
        return {
            summary: `Validator price snapshot${chainSuffix}`,
            details: [
                ...(coin ? [{ label: 'Coin', value: coin }] : []),
                ...(fiat ? [{ label: 'Currency', value: fiat }] : []),
                ...(value ? [{ label: 'Value', value }] : []),
            ],
            warnings: [
                'PRICE v0 is published by the validator federation, not by a wallet. The network will reject this transaction.',
            ],
        };
    }

    // FEE is a fraction on the wire (0.01 = 1%); show both so a publisher
    // who typed one and meant the other notices before signing.
    const feePct = fee && Number.isFinite(Number(fee))
        ? `${fee} (${(Number(fee) * 100).toFixed(2).replace(/\.?0+$/, '')}% of a dispenser's projected proceeds)`
        : fee;

    return {
        summary: `Publish oracle price 1 ${tick || '?'} = ${value || '?'} ${fiat || '?'}${chainSuffix}`,
        details: [
            { label: 'Token', value: coin && tick ? `${coin}:${tick}` : tick },
            { label: 'Currency', value: fiat },
            { label: 'Price per unit', value: value ? `${value} ${fiat}`.trim() : '' },
            ...(fee ? [{ label: 'Oracle usage fee', value: feePct }] : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            'This price takes effect 24 hours from now and cannot be changed or withdrawn before then. A correction is another publish, which also takes 24 hours.',
            'Dispensers that name this address as their oracle will sell at this price once it takes effect.',
            ...(!tick ? ['Token ticker is empty.'] : []),
            ...(!fiat ? ['Currency is empty.'] : []),
            ...(!value || Number(value) <= 0 ? ['Price is not a positive number.'] : []),
            ...(fee && Number(fee) > 1
                ? ['Oracle usage fee is above 1 (100%): the protocol will reject this transaction.']
                : []),
            ...(memo && /[|;]/.test(memo)
                ? ['Memo contains | or ;: the protocol will reject this transaction.']
                : []),
        ],
    };
}

/**
 * BROADCAST decoder. §40.6. Protocol BROADCAST.md defines four format
 * versions; the wallet's authoring form emits v0/v1/v2 based on which
 * fields the user filled (v3, feed-results, is a resolve path reached
 * from an existing feed, not a standalone authoring surface). Each
 * version prints a different summary so the sign screen tells the user
 * whether they're publishing a plain message, an oracle value, or a
 * feed-URL announcement.
 */
function decodeBroadcast(p, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const message = str(p.MESSAGE);
    const value = str(p.VALUE);
    const fee = str(p.FEE);
    const memo = str(p.MEMO);
    const actionIndex = str(p.BROADCAST_ACTION_INDEX);

    const baseWarnings = [
        ...(memo && /[|;]/.test(memo)
            ? ['Memo contains | or ;: the protocol will reject this transaction.']
            : []),
        ...(message && /[|;]/.test(message)
            ? ['Message contains | or ;: the protocol will reject this transaction.']
            : []),
    ];

    if (version === '3') {
        // Feed-results: publish a resolving value for a prior feed.
        return {
            summary: `Publish feed result${chainSuffix}${actionIndex ? ` (feed #${actionIndex})` : ''}`,
            details: [
                ...(actionIndex ? [{ label: 'Feed action index', value: actionIndex }] : []),
                ...(value ? [{ label: 'Value', value }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!actionIndex ? ['Feed action index is empty.'] : []),
                ...baseWarnings,
            ],
        };
    }

    if (version === '1') {
        // Oracle: feed label + value + usage fee.
        return {
            summary: `Publish oracle value ${value || '?'} for ${message || '?'}${chainSuffix}`,
            details: [
                { label: 'Feed', value: message },
                { label: 'Value', value },
                ...(fee ? [{ label: 'Feed fee', value: `${fee}%` }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!message ? ['Feed name is empty.'] : []),
                ...(!value ? ['Oracle value is empty.'] : []),
                ...baseWarnings,
            ],
        };
    }

    if (version === '2') {
        // Feed: URL + usage fee, no value.
        return {
            summary: `Publish feed ${message || '?'}${chainSuffix}`,
            details: [
                { label: 'Feed', value: message },
                ...(fee ? [{ label: 'Feed fee', value: `${fee}%` }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(!message ? ['Feed identifier is empty.'] : []),
                ...baseWarnings,
            ],
        };
    }

    // Version 0: plain broadcast message.
    return {
        summary: `Broadcast "${message || ''}"${chainSuffix}`,
        details: [
            { label: 'Message', value: message },
            ...(value ? [{ label: 'Value', value }] : []),
            ...(memo ? [{ label: 'Memo', value: memo }] : []),
        ],
        warnings: [
            ...(!message ? ['Message is empty.'] : []),
            ...baseWarnings,
        ],
    };
}

/**
 * ISSUE decoder. Six format versions. Summaries differentiate
 * "create a token" from the narrower "update the XYZ settings of an
 * existing token" variants so the user sees at the sign screen what
 * the transaction actually does.
 */
function decodeIssue(p, chainName, chainSuffix) {
    const version = str(p.VERSION) || '0';
    const tick = str(p.TICK);
    const memo = str(p.MEMO);

    const baseWarnings = [
        ...(!tick ? ['Token ticker is empty.'] : []),
        ...(memo && /[|;]/.test(memo)
            ? ['Memo contains | or ;: the protocol will reject this transaction.']
            : []),
    ];

    if (version === '1') {
        // Edit description.
        const description = str(p.DESCRIPTION);
        return {
            summary: `Update description of ${tick || '?'}${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                { label: 'New description', value: description },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: baseWarnings,
        };
    }

    if (version === '2') {
        // Edit mint params.
        const maxMint = str(p.MAX_MINT);
        const mintSupply = str(p.MINT_SUPPLY);
        const transferSupply = str(p.TRANSFER_SUPPLY);
        const mintAddressMax = str(p.MINT_ADDRESS_MAX);
        const mintStart = str(p.MINT_START_BLOCK);
        const mintStop = str(p.MINT_STOP_BLOCK);
        return {
            summary: `Update mint parameters of ${tick || '?'}${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                ...(maxMint ? [{ label: 'Max mint per tx', value: maxMint }] : []),
                ...(mintSupply ? [{ label: 'Mint now', value: mintSupply }] : []),
                ...(transferSupply ? [{ label: 'Transfer minted supply to', value: transferSupply }] : []),
                ...(mintAddressMax ? [{ label: 'Max mint per address', value: mintAddressMax }] : []),
                ...(mintStart ? [{ label: 'Mint start block', value: mintStart }] : []),
                ...(mintStop ? [{ label: 'Mint stop block', value: mintStop }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: baseWarnings,
        };
    }

    if (version === '3') {
        // Edit lock params. Every flag set is an irreversible lock.
        const lockFlags = collectLockFlags(p);
        return {
            summary: lockFlags.length > 0
                ? `Lock ${tick || '?'} (${lockFlags.join(', ')})${chainSuffix}`
                : `Update lock parameters of ${tick || '?'}${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                ...(lockFlags.length > 0
                    ? [{ label: 'Locking', value: lockFlags.join(', ') }]
                    : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(lockFlags.length > 0
                    ? ['Locking is permanent. These properties cannot be changed after this transaction confirms.']
                    : []),
                ...baseWarnings,
            ],
        };
    }

    if (version === '4') {
        // Edit callback params.
        const callbackBlock = str(p.CALLBACK_BLOCK);
        const callbackTick = str(p.CALLBACK_TICK);
        const callbackAmount = str(p.CALLBACK_AMOUNT);
        return {
            summary: `Update callback parameters of ${tick || '?'}${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                ...(callbackBlock ? [{ label: 'Callback at block', value: callbackBlock }] : []),
                ...(callbackTick ? [{ label: 'Callback token', value: callbackTick }] : []),
                ...(callbackAmount ? [{ label: 'Callback amount', value: callbackAmount }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: baseWarnings,
        };
    }

    if (version === '5') {
        // Edit allow / block lists.
        const allowList = str(p.ALLOW_LIST);
        const blockList = str(p.BLOCK_LIST);
        return {
            summary: `Update allow/block list for ${tick || '?'}${chainSuffix}`,
            details: [
                { label: 'Token', value: tick },
                ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
                ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: baseWarnings,
        };
    }

    // Version 0: full create-or-update. Differentiate the common
    // shapes so the summary matches what the user actually did:
    //   - Fresh token creation: MAX_SUPPLY present (usually with
    //     MINT_SUPPLY to seed initial balance).
    //   - Transfer-ownership-only: TRANSFER set, no supply fields.
    //   - Otherwise: generic "configure" update.
    const maxSupply = str(p.MAX_SUPPLY);
    const maxMint = str(p.MAX_MINT);
    const decimals = str(p.DECIMALS);
    const description = str(p.DESCRIPTION);
    const mintSupply = str(p.MINT_SUPPLY);
    const transfer = str(p.TRANSFER);
    const transferSupply = str(p.TRANSFER_SUPPLY);
    const mintAddressMax = str(p.MINT_ADDRESS_MAX);
    const mintStart = str(p.MINT_START_BLOCK);
    const mintStop = str(p.MINT_STOP_BLOCK);
    const lockFlags = collectLockFlags(p);
    // PC-06: ISSUE v0 also carries the callback trio and the access
    // lists, and the wizard's advanced disclosure is the first wallet
    // path that fills them in at create time. Same labels the v4 / v5
    // edit branches use, so the same setting reads the same either way.
    const callbackBlock = str(p.CALLBACK_BLOCK);
    const callbackTick = str(p.CALLBACK_TICK);
    const callbackAmount = str(p.CALLBACK_AMOUNT);
    const allowList = str(p.ALLOW_LIST);
    const blockList = str(p.BLOCK_LIST);

    const isCreate = maxSupply !== '' || mintSupply !== '';
    const isTransferOnly = !isCreate && transfer !== '' && maxMint === '' && description === '';

    let summary;
    if (isCreate) {
        summary = maxSupply
            ? `Create token ${tick || '?'} with max supply ${maxSupply}${chainSuffix}`
            : `Create token ${tick || '?'}${chainSuffix}`;
    } else if (isTransferOnly) {
        summary = `Transfer ownership of ${tick || '?'} to ${transfer}${chainSuffix}`;
    } else {
        summary = `Configure token ${tick || '?'}${chainSuffix}`;
    }

    const details = [
        { label: 'Token', value: tick },
        ...(maxSupply ? [{ label: 'Max supply', value: maxSupply }] : []),
        ...(maxMint ? [{ label: 'Max mint per tx', value: maxMint }] : []),
        ...(mintAddressMax ? [{ label: 'Max mint per address', value: mintAddressMax }] : []),
        ...(mintStart ? [{ label: 'Mint start block', value: mintStart }] : []),
        ...(mintStop ? [{ label: 'Mint stop block', value: mintStop }] : []),
        ...(decimals ? [{ label: 'Decimals', value: decimals }] : []),
        ...(description ? [{ label: 'Description', value: description }] : []),
        ...(mintSupply ? [{ label: 'Initial mint', value: mintSupply }] : []),
        ...(transfer ? [{ label: 'Transfer ownership to', value: transfer }] : []),
        ...(transferSupply ? [{ label: 'Transfer initial supply to', value: transferSupply }] : []),
        ...(callbackBlock ? [{ label: 'Callback at block', value: callbackBlock }] : []),
        ...(callbackTick ? [{ label: 'Callback token', value: callbackTick }] : []),
        ...(callbackAmount ? [{ label: 'Callback amount', value: callbackAmount }] : []),
        ...(allowList ? [{ label: 'Allow list', value: allowList }] : []),
        ...(blockList ? [{ label: 'Block list', value: blockList }] : []),
        ...(lockFlags.length > 0
            ? [{ label: 'Locking', value: lockFlags.join(', ') }]
            : []),
        ...(memo ? [{ label: 'Memo', value: memo }] : []),
    ];

    const warnings = [
        ...(lockFlags.length > 0
            ? ['Locking is permanent. These properties cannot be changed after this transaction confirms.']
            : []),
        // An allow-list is default-deny: binding one at create means the
        // token is unusable by anyone the list omits, which is not
        // obvious from a bare list number on the confirm screen.
        ...(allowList
            ? ['An allow list restricts this token to the addresses on that list. Everyone else is denied.']
            : []),
        ...(callbackBlock || callbackTick || callbackAmount
            ? ['A callback lets the owner recall every holder\'s balance after the callback block, paying them the callback amount.']
            : []),
        ...baseWarnings,
    ];

    return { summary, details, warnings };
}

/**
 * BATCH decoder. Composes summaries + warnings from every nested
 * command. The wallet emits BATCH with params shaped as
 * `{ COMMANDS: [{ action, params }, ...] }`; protocol §BATCH v0
 * supports any command set with one ISSUE + one MINT max (no nested
 * BATCH or FILE). If COMMANDS is missing or malformed the decoder
 * falls back to a generic summary so the user sees *something*
 * before signing.
 */
function decodeBatch(p, chainId, chainName, chainSuffix, chainRegistry) {
    const commands = Array.isArray(p.COMMANDS) ? p.COMMANDS : [];
    if (commands.length === 0) {
        return {
            summary: `Batch of actions${chainSuffix}`,
            details: [],
            warnings: [
                'Batch has no decoded commands. Review the raw transaction carefully before signing.',
            ],
        };
    }

    const decodedChildren = commands.map((cmd) => {
        if (!cmd || typeof cmd !== 'object') {
            return {
                summary: 'Unknown command',
                details: [],
                warnings: ['A batch command is malformed.'],
            };
        }
        return decodeAction({
            action: cmd.action,
            params: cmd.params,
            chainId,
            chainRegistry,
        });
    });

    const summaryLines = decodedChildren.map((c, i) => `${i + 1}. ${c.summary}`);
    const summary = `Batch of ${commands.length} action${commands.length === 1 ? '' : 's'}${chainSuffix}:\n${summaryLines.join('\n')}`;

    const details = decodedChildren.flatMap((child, i) => [
        {
            label: `Step ${i + 1}`,
            value: child.summary,
        },
        ...child.details.map((d) => ({
            label: `  ${d.label}`,
            value: d.value,
        })),
    ]);

    const warnings = decodedChildren.flatMap((child) => child.warnings);

    return { summary, details, warnings };
}

/**
 * Collect human-readable names of every lock flag the ISSUE params
 * turn on. Treats any truthy value (including the string "1" the SDK
 * serializes booleans as) as "this lock is active".
 */
function collectLockFlags(p) {
    /** @type {Array<[string, string]>} */
    const flags = [
        ['LOCK_MAX_SUPPLY', 'max supply'],
        ['LOCK_MAX_MINT', 'max mint'],
        ['LOCK_MINT', 'minting'],
        ['LOCK_MINT_SUPPLY', 'mint-supply'],
        ['LOCK_DESCRIPTION', 'description'],
        ['LOCK_SLEEP', 'sleep'],
        ['LOCK_CALLBACK', 'callback'],
    ];
    const active = [];
    for (const [field, label] of flags) {
        const v = p[field];
        if (v === undefined || v === null || v === '' || v === '0' || v === 0 || v === false) continue;
        active.push(label);
    }
    return active;
}

function genericFallback(action, p, chainSuffix) {
    // Fallback: unknown or later-phase action kinds.
    // Param keys are raw wire fields (TICK, GAS_LIMIT); title-case them
    // directly rather than via actionDisplayLabel, whose action-name map
    // would mistranslate keys that collide with action verbs (e.g. LIST).
    const humanizeKey = (k) => {
        const words = String(k).trim().toLowerCase().replace(/[_-]+/g, ' ');
        return words.charAt(0).toUpperCase() + words.slice(1);
    };
    const paramEntries = Object.entries(p).map(([k, v]) => ({
        label: humanizeKey(k),
        value: typeof v === 'string' ? v : safeJson(v),
    }));
    const verb = action ? actionDisplayLabel(action) : 'unknown action';
    return {
        summary: `Sign ${verb}${chainSuffix}`,
        details: paramEntries,
        warnings: [
            `No plain-English summary is available for "${verb}" yet. Review the parameters carefully before approving.`,
        ],
    };
}

function str(v) {
    if (v === undefined || v === null) return '';
    return String(v);
}

function toArray(v) {
    if (v === undefined || v === null || v === '') return [];
    if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null && x !== '');
    return [v];
}

function safeJson(v) {
    try {
        return JSON.stringify(v);
    } catch (_err) {
        return String(v);
    }
}
