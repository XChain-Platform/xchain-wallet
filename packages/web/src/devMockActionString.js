// Dev-shell stand-in for the SDK's action serializer. SEND-shaped by default
// (ACTION|0|TICK|AMOUNT|DESTINATION[|MEMO]); BROADCAST carries its own layout.
export function buildDevMockActionString(action, params) {
    const p = params || {};
    if (action === 'BROADCAST') {
        return [action, p.VERSION ?? '0', p.MESSAGE, p.VALUE, p.FEE, p.MEMO]
            .filter((f) => f != null && f !== '')
            .join('|');
    }
    const tail = [p.TICK, p.AMOUNT, p.DESTINATION];
    if (p.MEMO != null && p.MEMO !== '') tail.push(p.MEMO);
    return [action, '0', ...tail.filter((f) => f != null)].join('|');
}
