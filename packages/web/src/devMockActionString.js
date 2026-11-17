// Dev-shell stand-in for the SDK's action serializer. SEND-shaped by default
// (ACTION|0|TICK|AMOUNT|DESTINATION[|MEMO]); BROADCAST carries its own layout.
export function buildDevMockActionString(action, params) {
    const p = params || {};
    if (action === 'BROADCAST') {
        return [action, p.VERSION ?? '0', p.MESSAGE, p.VALUE, p.FEE, p.MEMO]
            .filter((f) => f != null && f !== '')
            .join('|');
    }
    if (action === 'VOTE') {
        const fields = [
            action,
            p.version ?? p.VERSION ?? '0',
            p.tick ?? p.TICK,
            p.endBlock ?? p.END_BLOCK,
            p.options ?? p.OPTIONS,
            p.maxSelections ?? p.MAX_SELECTIONS,
            p.tallyMode ?? p.TALLY_MODE,
            p.weightMode ?? p.WEIGHT_MODE,
            p.quorum ?? p.QUORUM,
            p.minVoters ?? p.MIN_VOTERS,
            p.minVoteBalance ?? p.MIN_VOTE_BALANCE,
            p.decideThreshold ?? p.DECIDE_THRESHOLD,
            p.question ?? p.QUESTION,
            p.deposit ?? p.DEPOSIT,
            p.callbackContract ?? p.CALLBACK_CONTRACT,
            p.callbackMethod ?? p.CALLBACK_METHOD,
            p.callbackParams ?? p.CALLBACK_PARAMS,
            p.callbackOn ?? p.CALLBACK_ON,
            p.gasEscrow ?? p.GAS_ESCROW,
            p.callbackDelayBlocks ?? p.CALLBACK_DELAY_BLOCKS,
        ].map((field) => (field == null ? '' : String(field)));
        while (fields.at(-1) === '') fields.pop();
        return fields.join('|');
    }
    const tail = [p.TICK, p.AMOUNT, p.DESTINATION];
    if (p.MEMO != null && p.MEMO !== '') tail.push(p.MEMO);
    return [action, '0', ...tail.filter((f) => f != null)].join('|');
}
