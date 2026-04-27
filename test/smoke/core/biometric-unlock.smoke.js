// Smoke for §26 Lock & Panic — Step 4 — G063 — biometric unlock flow.
// Mocks navigator.credentials + PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
// + globalThis.localStorage so the smoke runs in Node without a real
// platform authenticator.
//
// The cryptographic round-trip (PRF output → AES-GCM key → password
// ciphertext → unwrap) is the load-bearing assertion: register a
// credential, simulate an assertion that returns the same PRF output,
// and confirm `unlockWithBiometric` returns the original password.

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

globalThis.localStorage = new FakeStorage();

// Deterministic 32-byte PRF output for tests. The SAME bytes must come
// back on the assertion (browser side) and the registration side.
const PRF_OUTPUT = new Uint8Array(32).fill(0xAB);
const CRED_ID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

let lastCreateOpts = null;
let lastGetOpts = null;
let createCount = 0;
let getCount = 0;

function fakeCredential(idBytes, prfFirst) {
    return {
        rawId: idBytes.buffer.slice(idBytes.byteOffset, idBytes.byteOffset + idBytes.byteLength),
        getClientExtensionResults() {
            return prfFirst ? { prf: { results: { first: prfFirst.buffer } } } : {};
        },
    };
}

globalThis.PublicKeyCredential = class {
    static async isUserVerifyingPlatformAuthenticatorAvailable() { return true; }
};

globalThis.navigator = {
    credentials: {
        async create(opts) {
            createCount += 1;
            lastCreateOpts = opts;
            // Simulate the common Chrome behaviour: PRF NOT returned on
            // create; force the flow to fall back to derivePrfViaAssertion.
            return fakeCredential(CRED_ID, null);
        },
        async get(opts) {
            getCount += 1;
            lastGetOpts = opts;
            return fakeCredential(CRED_ID, PRF_OUTPUT);
        },
    },
};
globalThis.window = { location: { hostname: 'localhost' } };

const flow = await import(
    '../../../packages/core/src/flows/biometricUnlock.js'
);

const {
    isBiometricSupported,
    isBiometricRegistered,
    clearBiometricCredential,
    registerBiometricCredential,
    unlockWithBiometric,
    BiometricNotRegisteredError,
} = flow;

// --- support probe -----------------------------------------------------

assert.equal(await isBiometricSupported(), true, 'support probe true with full mocks');

// --- not-registered initial state -------------------------------------

assert.equal(isBiometricRegistered(), false, 'starts unregistered');

await assert.rejects(
    unlockWithBiometric(),
    (err) => err instanceof BiometricNotRegisteredError,
    'unwrap before register throws BiometricNotRegisteredError',
);

// --- register ---------------------------------------------------------

await registerBiometricCredential({ password: 'correct horse battery staple' });

assert.equal(isBiometricRegistered(), true, 'registered after success');
assert.equal(createCount, 1, 'create() called exactly once');
assert.ok(getCount >= 1, 'get() called at least once for PRF derivation');

// create() request shape -------------------------------------------------

const create = lastCreateOpts.publicKey;
assert.equal(create.rp.name, 'XChain Wallet');
assert.equal(create.rp.id, 'localhost');
assert.equal(create.authenticatorSelection.userVerification, 'required',
    'register demands userVerification=required');
assert.equal(create.authenticatorSelection.authenticatorAttachment, 'platform',
    'platform-bound credential only');
assert.ok(create.extensions?.prf?.eval?.first instanceof Uint8Array, 'PRF salt sent on create');

// get() request shape (used to derive the PRF output) -------------------

const get = lastGetOpts.publicKey;
assert.equal(get.userVerification, 'required', 'assertion demands UV=required');
assert.ok(Array.isArray(get.allowCredentials) && get.allowCredentials.length === 1,
    'assertion sends allowCredentials');
assert.ok(get.allowCredentials[0].id instanceof Uint8Array, 'credential id Uint8Array');
assert.ok(get.extensions?.prf?.eval?.first instanceof Uint8Array, 'PRF salt sent on get');

// --- persisted record shape -------------------------------------------

const raw = globalThis.localStorage.getItem('xchain-wallet:biometric');
assert.ok(raw, 'record persisted');
const parsed = JSON.parse(raw);
assert.ok(parsed.credentialId, 'credentialId stored');
assert.ok(parsed.prfSalt, 'prfSalt stored');
assert.ok(parsed.ciphertext, 'ciphertext stored');
assert.equal(typeof parsed.createdAt, 'number');

// Ciphertext must NOT contain the plaintext password.
assert.equal(parsed.ciphertext.includes('correct horse'), false,
    'plaintext does not leak into ciphertext base64');

// --- unlock round-trip -----------------------------------------------

const got = await unlockWithBiometric();
assert.equal(got, 'correct horse battery staple', 'PRF round-trip recovers password');

// --- Settings disable wipes record ------------------------------------

clearBiometricCredential();
assert.equal(isBiometricRegistered(), false, 'cleared');
assert.equal(globalThis.localStorage.getItem('xchain-wallet:biometric'), null);

// --- corruption tolerance --------------------------------------------

globalThis.localStorage.setItem('xchain-wallet:biometric', '{ not json');
assert.equal(isBiometricRegistered(), true, 'malformed but truthy raw → registered hint stays true');
await assert.rejects(unlockWithBiometric(), /BiometricNotRegisteredError|biometricUnlock/);

clearBiometricCredential();
globalThis.localStorage.setItem('xchain-wallet:biometric', JSON.stringify({ credentialId: 1 }));
await assert.rejects(unlockWithBiometric(), /BiometricNotRegisteredError|biometricUnlock/);

// --- support probe negatives -----------------------------------------

const origPKC = globalThis.PublicKeyCredential;
globalThis.PublicKeyCredential = undefined;
assert.equal(await isBiometricSupported(), false,
    'no PublicKeyCredential → unsupported');
globalThis.PublicKeyCredential = origPKC;

const origCreds = globalThis.navigator.credentials;
globalThis.navigator.credentials = undefined;
assert.equal(await isBiometricSupported(), false,
    'no navigator.credentials → unsupported');
globalThis.navigator.credentials = origCreds;

console.log('biometric-unlock smoke OK');
