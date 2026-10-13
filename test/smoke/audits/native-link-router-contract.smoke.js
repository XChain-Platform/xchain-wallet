// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';
import { isAcceptableDeepLink } from '../../../packages/web/src/deeplinks/nativeDeepLinks.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

const parser = read('packages/core/src/uri/xchainUri.js');
const intake = read('packages/web/src/deeplinks/nativeDeepLinks.js');
const manifest = read('packages/mobile/android/app/src/main/AndroidManifest.xml');
const androidInbox = read(
    'packages/mobile/android/app/src/main/java/io/xchain/wallet/android/links/XChainLinksPlugin.java',
);
const infoPlist = read('packages/mobile/ios/App/App/Info.plist');
const entitlements = read('packages/mobile/ios/App/App/App.entitlements');
const iosInbox = read('packages/mobile/ios/App/App/links/XChainLinksPlugin.swift');
const webApp = read('packages/web/src/App.jsx');

const origin = /WEB_LINK_ORIGIN\s*=\s*'([^']+)'/.exec(parser)?.[1];
const prefix = /WEB_LINK_PREFIX\s*=\s*'([^']+)'/.exec(parser)?.[1];
assert.ok(origin && prefix, 'the URI router must state its web origin and path prefix');
const webHost = new URL(origin).host;

const verifiedFilters = [...manifest.matchAll(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g)];
assert.equal(verifiedFilters.length, 1, 'Android must have one auto-verified App Link filter');
const appLink = /<data android:scheme="https" android:host="([^"]+)" android:pathPrefix="([^"]+)" \/>/
    .exec(verifiedFilters[0][1]);
assert.ok(appLink, 'the verified Android filter must constrain scheme, host, and path');
assert.deepEqual(
    { host: appLink[1], prefix: appLink[2] },
    { host: webHost, prefix },
    'the verified Android claim must equal the web-link pattern accepted by the router',
);

const entitlementHosts = [...entitlements.matchAll(/<string>applinks:([^<]+)<\/string>/g)].map((m) => m[1]);
assert.deepEqual(entitlementHosts, [webHost], 'iOS must associate only the router-owned web host');

const schemeArray = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(infoPlist)?.[1];
assert.ok(schemeArray, 'iOS must declare its inbound custom schemes');
const iosSchemes = [...schemeArray.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => `${m[1]}:`).sort();
const jsSchemes = /APP_SCHEMES\s*=\s*\[([^\]]+)\]/.exec(intake)?.[1]
    ?.split(',').map((item) => item.trim().replaceAll("'", '')).sort();
assert.ok(jsSchemes, 'the native JavaScript intake must state its accepted schemes');
assert.deepEqual(iosSchemes, jsSchemes, 'iOS URL schemes must equal the mobile router intake schemes');

const androidSchemes = [...manifest.matchAll(/<data android:scheme="([^"]+)" \/>/g)]
    .map((m) => `${m[1]}:`).sort();
assert.deepEqual(androidSchemes, jsSchemes, 'Android custom schemes must equal the mobile router intake schemes');

for (const [source, pathConstant, pathCheck, label] of [
    [androidInbox, /PATH_PREFIX_WEB\s*=\s*"([^"]+)"/, 'encodedPath.startsWith(PATH_PREFIX_WEB)', 'Android'],
    [iosInbox, /pathPrefixWeb\s*=\s*"([^"]+)"/, 'percentEncodedPath.hasPrefix(Self.pathPrefixWeb)', 'iOS'],
]) {
    assert.equal(pathConstant.exec(source)?.[1], prefix, `${label} native intake path must equal the router path`);
    assert.ok(source.includes(pathCheck), `${label} native intake must enforce its declared path`);
}

const registry = { chainIdFor: () => 'bitcoin-mainnet' };
const valid = `${origin}${prefix}?uri=${encodeURIComponent('xchain:BTC/receive')}`;
const deep = `${origin}${prefix}v1/invoice/9?uri=${encodeURIComponent('xchain:BTC/receive')}`;
for (const url of [valid, deep]) {
    assert.equal(isAcceptableDeepLink(url), true, `${url} must pass the mobile intake`);
    assert.equal(deepLinkRoute(url, registry)?.view, 'receive', `${url} must reach the requested safe form`);
}
for (const path of ['/wallet/link', '/wallet/linkage/x', '/wallet/privacy/', '/wallet/support/']) {
    const url = `${origin}${path}?uri=${encodeURIComponent('xchain:BTC/send')}`;
    assert.equal(isAcceptableDeepLink(url), false, `${url} must remain outside the native claim`);
    assert.equal(deepLinkRoute(url, registry), null, `${url} must not select a wallet route`);
}
assert.match(
    webApp,
    /const \[unlockedView, setUnlockedView\] = useState\([\s\S]*?\('home'\),\s*\);/,
    'an unclaimed path that starts the shell must leave the wallet on its safe Home default',
);
assert.match(
    webApp,
    /const route = deepLinkRoute\(raw, APP_CHAIN_REGISTRY\);\s*if \(!route\) return;/,
    'an unknown path must not replace Home with an unrecognized view',
);

console.log('native link router contract smoke OK');
