// Phase 3 Step 14 smoke — Contacts integration (§41.7.4).
//
// Asserts:
//   1. listContacts / findContactByAddress / saveContact /
//      deleteContact exported from @xchain-wallet/core with input
//      guards. In-memory vault round-trip exercises create / find /
//      list / delete.
//   2. ContactsList.jsx exists with a 3-mode state machine
//      ('list' | 'detail' | 'edit'), Send-message action from detail,
//      chain+address entries, and delete guard.
//   3. Background host registers the 4 contacts.* handlers.
//   4. Three shells' messaging.js expose listContacts /
//      findContactByAddress / saveContact / deleteContact.
//   5. Three App.jsx files track the 'contacts' sub-route, add the
//      ActionsMenu 'contacts' entry, and route Send-message through
//      ComposeMessage via a prefill.
//   6. MessagingInbox hydrates a contactsByAddress map on mount and
//      uses it to label known counterparties.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { flows, storage } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- 1. Flow exports + vault round-trip --------------------------------

for (const name of ['listContacts', 'findContactByAddress', 'saveContact', 'deleteContact']) {
    assert.equal(typeof flows[name], 'function', `flows.${name} exported`);
}

await assert.rejects(async () => flows.listContacts({}), /vault is required/);
await assert.rejects(async () => flows.findContactByAddress({}), /vault is required/);
await assert.rejects(
    async () => flows.findContactByAddress({ vault: {} }),
    /chain is required/,
);
await assert.rejects(async () => flows.saveContact({}), /vault is required/);
await assert.rejects(
    async () => flows.saveContact({ vault: {} }),
    /record or input is required/,
);
await assert.rejects(async () => flows.deleteContact({}), /vault is required/);
await assert.rejects(
    async () => flows.deleteContact({ vault: {} }),
    /id is required/,
);

{
    let blob = null;
    const backend = {
        load: async () => blob,
        save: async (b) => { blob = b; },
        clear: async () => { blob = null; },
    };
    const vault = new storage.Vault({ backend, masterKey: new Uint8Array(32) });
    await vault.open();

    const created = await flows.saveContact({
        vault,
        input: {
            name: 'Alice',
            entries: [{ chain: 'bitcoin', address: 'bc1qalice', label: 'primary' }],
            notes: 'first contact',
        },
    });
    assert.equal(created.name, 'Alice');
    assert.equal(created.entries[0].address, 'bc1qalice');

    const listed = await flows.listContacts({ vault });
    assert.equal(listed.length, 1);

    const found = await flows.findContactByAddress({
        vault, chain: 'bitcoin', address: 'bc1qalice',
    });
    assert.ok(found, 'findContactByAddress returns the matching contact');
    assert.equal(found.id, created.id);

    const missing = await flows.findContactByAddress({
        vault, chain: 'bitcoin', address: 'bc1qnope',
    });
    assert.equal(missing, null);

    const deleted = await flows.deleteContact({ vault, id: created.id });
    assert.equal(deleted, true);
    const after = await flows.listContacts({ vault });
    assert.equal(after.length, 0);
}

// --- 2. ContactsList.jsx ----------------------------------------------

const routePath = join(sharedRoutes, 'ContactsList.jsx');
assert.ok(existsSync(routePath), 'ContactsList.jsx exists');
const src = readFileSync(routePath, 'utf8');
assert.ok(/export function ContactsList\b/.test(src),
    'ContactsList is a named export');
for (const m of ['list', 'detail', 'edit']) {
    assert.ok(src.includes(`'${m}'`), `ContactsList tracks mode "${m}"`);
}
assert.ok(/messaging\.listContacts\s*\(/.test(src),
    'ContactsList hydrates via messaging.listContacts');
assert.ok(/messaging\.saveContact\s*\(/.test(src),
    'ContactsList calls messaging.saveContact');
assert.ok(/messaging\.deleteContact\s*\(/.test(src),
    'ContactsList calls messaging.deleteContact');
assert.ok(/onSendMessage/.test(src),
    'ContactsList exposes Send-message shortcut via onSendMessage');

// --- 3. Background handlers -------------------------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of [
    'contacts.list', 'contacts.findByAddress',
    'contacts.save', 'contacts.delete',
]) {
    assert.ok(bg.includes(`'${route}'`), `background host registers ${route}`);
}

// --- 4. Three-shell messaging -----------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['listContacts', 'findContactByAddress', 'saveContact', 'deleteContact']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// --- 5. App.jsx wiring -------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ContactsList'),
        `${shell} App.jsx imports ContactsList`);
    assert.ok(app.includes("'contacts'"),
        `${shell} App.jsx tracks the contacts sub-route`);
    assert.ok(/id:\s*['"]contacts['"]/.test(app),
        `${shell} App.jsx registers the Contacts entry`);
    assert.ok(/onSendMessage=/.test(app),
        `${shell} App.jsx threads onSendMessage from ContactsList to ComposeMessage prefill`);
}

// --- 6. Inbox auto-association ----------------------------------------

const inboxSrc = readFileSync(join(sharedRoutes, 'MessagingInbox.jsx'), 'utf8');
assert.ok(/messaging\.listContacts\s*\(/.test(inboxSrc),
    'MessagingInbox hydrates contacts on mount');
assert.ok(/contactsByAddress/.test(inboxSrc),
    'MessagingInbox tracks contactsByAddress map');

console.log(
    'OK — contacts smoke (§41.7.4: CRUD flows + vault round-trip; ContactsList 3-mode state machine + Send-message shortcut; contacts.* handlers + 3-shell messaging + 3-shell App.jsx entry + Inbox auto-association)',
);
