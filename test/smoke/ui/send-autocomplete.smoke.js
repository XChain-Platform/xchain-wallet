// Smoke for §29 Send/Receive — Step 1 — Send.jsx wires the
// AddressCombobox + suggestion fetch + paste handler.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);

// --- imports -------------------------------------------------------------

assert.match(sendSrc, /AddressCombobox,/, 'AddressCombobox imported from ui');
assert.match(
    sendSrc,
    /import \{ buildRecentDestinations \} from '\.\.\/\.\.\/flows\/recentDestinations\.js'/,
    'imports buildRecentDestinations',
);
assert.match(
    sendSrc,
    /uri as uriLib/,
    'imports the uri namespace for paste detection',
);

// --- suggestion fetch ----------------------------------------------------

assert.match(
    sendSrc,
    /messaging\.listContacts\(\)/,
    'fetches contacts on mount',
);
assert.match(
    sendSrc,
    /messaging\.getAddressHistory\(\{\s*chainId,\s*address:/,
    'fetches per-address history when chain changes',
);
assert.match(
    sendSrc,
    /buildRecentDestinations\(\{[\s\S]*contacts,[\s\S]*chainCoin:[\s\S]*historyRows,[\s\S]*\}\)/,
    'feeds the helper contacts + chainCoin + historyRows',
);

// --- combobox in the form ------------------------------------------------

const formIdx = sendSrc.indexOf('<AddressCombobox');
assert.notEqual(formIdx, -1, 'AddressCombobox renders in the form');
const formBlock = sendSrc.slice(formIdx, formIdx + 800);
assert.match(formBlock, /label="To"/, 'To label preserved');
assert.match(formBlock, /value=\{toAddress\}/);
assert.match(formBlock, /onPaste=\{onAddressPaste\}/, 'paste handler wired');
assert.match(formBlock, /suggestions=\{suggestions\}/);
assert.match(formBlock, /hint=\{pasteHint \|\| undefined\}/, 'paste hint surfaces in hint slot');

// The To-field is no longer a bare <Input>. Asset / Amount / Memo still are.
assert.doesNotMatch(
    formBlock,
    /<Input\s+label="To"/,
    'To-field no longer rendered as bare Input',
);

// --- paste handler -------------------------------------------------------

assert.match(sendSrc, /uriLib\.detectQrContent\(/, 'paste path runs detectQrContent');
assert.match(sendSrc, /detected\.type === 'bip21'/, 'BIP21 branch');
assert.match(sendSrc, /detected\.type === 'xchain-uri'/, 'xchain: URI branch');
assert.match(sendSrc, /detected\.type === 'wif'/, 'WIF branch surfaces an import hint');
assert.match(
    sendSrc,
    /That looks like a private key/i,
    'WIF paste hint copy present',
);
assert.match(
    sendSrc,
    /e\.preventDefault\(\)/,
    'paste handler preempts default for matched URIs / WIF',
);

console.log('send-autocomplete smoke OK');
