// Plain-English action decoder — §21.1 / §30.
//
// Translates the raw protocol-shaped action payload (uppercase field
// names, string-encoded amounts) into UI-friendly strings the sign
// screens render. Pure function — no vault, no SDK, no network — so
// both shells can use the same decoder and the logic is trivial to
// smoke-test.
//
// Phase 1 covers SEND and SWEEP per §39.1. Phase 2 adds ISSUE (all 6
// format versions — create, edit-description, edit-mint-params, lock-
// params, edit-callback, edit-lists), MINT, DESTROY (v0 single; v1/v2
// multi-destroy falls through to the generic decoder), and BATCH (which
// recurses into its COMMANDS array and composes sub-decoder output).
// Every other ACTION type still gets the generic fallback — dedicated
// decoders for DISPENSER / DIVIDEND / AIRDROP / etc. land alongside
// their authoring forms in Phase 2 sub-pieces or Phase 3.

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
        const asset = str(p.TICK);
        const amount = str(p.AMOUNT);
        const dest = str(p.DESTINATION);
        const memo = str(p.MEMO);
        return {
            summary: `Send ${amount || '?'} ${asset || '?'}${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Asset', value: asset },
                { label: 'Amount', value: amount },
                { label: 'Destination', value: dest },
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                ...(memo && /[|;]/.test(memo)
                    ? ['Memo contains | or ; — the protocol will reject this transaction.']
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
        const flags = p.FLAGS !== undefined && p.FLAGS !== null ? str(p.FLAGS) : '';
        const memo = str(p.MEMO);
        return {
            summary: `Sweep all assets${chainSuffix} to ${dest || '?'}`,
            details: [
                { label: 'Destination', value: dest },
                ...(flags ? [{ label: 'Flags', value: flags }] : []),
                ...(memo ? [{ label: 'Memo', value: memo }] : []),
            ],
            warnings: [
                'Sweep moves every balance at the source address. Double-check the destination.',
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
                    ? ['Memo contains | or ; — the protocol will reject this transaction.']
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
                    'Destroying is irreversible — the tokens cannot be recovered.',
                    ...(!tick ? ['Token ticker is empty.'] : []),
                    ...(!amount || Number(amount) <= 0
                        ? ['Amount is not positive.']
                        : []),
                    ...(memo && /[|;]/.test(memo)
                        ? ['Memo contains | or ; — the protocol will reject this transaction.']
                        : []),
                ],
            };
        }
        // Multi-destroy: pass through to the generic path but prepend
        // the irreversibility warning so the user still sees it.
        const generic = genericFallback(action, p, chainSuffix);
        generic.warnings.unshift(
            'Destroying is irreversible — the tokens cannot be recovered.',
        );
        return generic;
    }

    if (action === 'BATCH') {
        return decodeBatch(p, chainId, chainName, chainSuffix, chainRegistry);
    }

    return genericFallback(action, p, chainSuffix);
}

/**
 * ISSUE decoder — six format versions. Summaries differentiate
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
            ? ['Memo contains | or ; — the protocol will reject this transaction.']
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
                    ? ['Locking is permanent — these properties cannot be changed after this transaction confirms.']
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

    // Version 0 — full create-or-update. Differentiate the common
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
    const lockFlags = collectLockFlags(p);

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
        ...(decimals ? [{ label: 'Decimals', value: decimals }] : []),
        ...(description ? [{ label: 'Description', value: description }] : []),
        ...(mintSupply ? [{ label: 'Initial mint', value: mintSupply }] : []),
        ...(transfer ? [{ label: 'Transfer ownership to', value: transfer }] : []),
        ...(transferSupply ? [{ label: 'Transfer initial supply to', value: transferSupply }] : []),
        ...(lockFlags.length > 0
            ? [{ label: 'Locking', value: lockFlags.join(', ') }]
            : []),
        ...(memo ? [{ label: 'Memo', value: memo }] : []),
    ];

    const warnings = [
        ...(lockFlags.length > 0
            ? ['Locking is permanent — these properties cannot be changed after this transaction confirms.']
            : []),
        ...baseWarnings,
    ];

    return { summary, details, warnings };
}

/**
 * BATCH decoder — composes summaries + warnings from every nested
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
                'Batch has no decoded commands — review the raw transaction carefully before signing.',
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
    const paramEntries = Object.entries(p).map(([k, v]) => ({
        label: k,
        value: typeof v === 'string' ? v : safeJson(v),
    }));
    return {
        summary: `Sign ${action || 'unknown action'}${chainSuffix}`,
        details: paramEntries,
        warnings: [
            `No plain-English summary is available for "${action || 'unknown action'}" yet — review the parameters carefully before approving.`,
        ],
    };
}

function str(v) {
    if (v === undefined || v === null) return '';
    return String(v);
}

function safeJson(v) {
    try {
        return JSON.stringify(v);
    } catch (_err) {
        return String(v);
    }
}
