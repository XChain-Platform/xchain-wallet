// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const CREATED = '2026-01-02T03:04:05.000Z';
const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_SECOND = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function contact(id, name, chain, address, extra = {}) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        entries: [{ chain, address, label: '' }],
        avatarSeed: address,
        createdAt: CREATED,
        updatedAt: CREATED,
        ...extra,
    };
}

export const malformedContactsJson = '[{"name":"Alice"}';

export const malformedContactsCsv = 'name,chain,address\nAlice,bitcoin,"unterminated\n';

export const auditedContactsJson = JSON.stringify([
    contact('alice', 'Alice', 'bitcoin', BTC),
    contact('unknown', 'Unknown field', 'bitcoin', BTC_SECOND, { nickname: 'Nope' }),
    contact('unsupported', 'Unsupported chain', 'ethereum', BTC_SECOND),
    contact('alice-copy', ' alice ', 'bitcoin', BTC_SECOND),
]);

