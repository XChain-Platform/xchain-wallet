// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import validate from './validate.js';
import contract from './schema.json' with { type: 'json' };
import snapshotSchema from './snapshot.schema.json' with { type: 'json' };
import detailSchema from './detail.schema.json' with { type: 'json' };
import intentsSchema from './intents.schema.json' with { type: 'json' };
import rowSchema from './row.schema.json' with { type: 'json' };
import receiveSchema from './receive.schema.json' with { type: 'json' };
import inboxSchema from './inbox.schema.json' with { type: 'json' };
import requestSchema from './request.schema.json' with { type: 'json' };
import settingsSchema from './settings.schema.json' with { type: 'json' };
import { checkQrBits } from './receiveBits.js';

export function createMessageValidator(kinds, { postChecks = {} } = {}) {
    function explainMessage(kind, value) {
        if (!Object.hasOwn(kinds, kind)) return ['$kind'];

        const paths = validate(kinds[kind], value);
        if (paths.length > 0) return paths;

        const postCheck = Object.hasOwn(postChecks, kind) ? postChecks[kind] : undefined;
        return postCheck ? postCheck(value) : [];
    }

    return {
        validateMessage: (kind, value) => explainMessage(kind, value).length === 0,
        explainMessage,
    };
}

const dereference = (schema, referenced) => {
    const resolved = { ...schema, ...referenced };
    delete resolved.$ref;
    return resolved;
};

const snapshot = {
    ...snapshotSchema,
    properties: {
        ...snapshotSchema.properties,
        rows: { ...snapshotSchema.properties.rows, items: rowSchema },
        receive: dereference(snapshotSchema.properties.receive, receiveSchema),
        inbox: dereference(snapshotSchema.properties.inbox, inboxSchema),
        request: dereference(snapshotSchema.properties.request, requestSchema),
        settings: dereference(snapshotSchema.properties.settings, settingsSchema),
    },
};

export const CONTRACT_VERSION = contract.v;
export const schemas = { snapshot, detail: detailSchema, ...intentsSchema.$defs };

const snapshotQrPaths = (value) => value.receive.flatMap(({ qr }, index) => (
    checkQrBits(qr) ? [] : [`$.receive[${index}].qr`]
));

export const { validateMessage, explainMessage } = createMessageValidator(schemas, {
    postChecks: { snapshot: snapshotQrPaths },
});
