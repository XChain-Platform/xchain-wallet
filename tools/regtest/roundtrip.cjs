#!/usr/bin/env node
/*
 * tools/regtest/roundtrip.cjs - reusable funded-signer regtest round-trip
 * driver ( / spec §14). Drives the live upstream BTC regtest stack:
 * funds a fresh key from the node wallet, then runs each action through the
 * full create -> encode -> sign -> broadcast -> confirm -> read-back cycle
 * via the SDK's submitAction, so a flow's honest end-to-end path can be
 * exercised against a real indexer (not a mock).
 *
 * Prereqs:
 *   - The upstream regtest stack reachable at the descriptor ports
 *     (explorer 18080, encoder BTC 3023, hub 10000). On the Mac, bring up
 *     the SSH tunnel from tools/regtest/README.md first, and confirm with
 *     `bash tools/regtest/bootstrap.sh`.
 *   - SSH access to the host running the bitcoind regtest node, for funding.
 *
 * Config (env):
 *   XCHAIN_REGTEST_SSH        ssh host alias for the node box (default: devhost)
 *   XCHAIN_REGTEST_NODE       node container name (default: xchain-node-bitcoin-regtest-node)
 *   XCHAIN_REGTEST_EXPLORER_PORT / _ENCODER_PORT / _HUB_PORT  (defaults 18080/3023/10000)
 *   XCHAIN_SDK_PATH           path to the xchain-sdk package (default: sibling ../xchain-sdk)
 *
 * WIFs generated here are throwaway regtest keys; still never printed.
 *
 * KNOWN LIMITATION: issuing a named token requires the XCHAIN protocol fee,
 * which a freshly funded BTC-only key does not hold, so the ISSUE below
 * indexes invalid and the follow-on token SEND has nothing to move. Both
 * still exercise the compose/fund/broadcast path (that is what this driver
 * proves). To premine a real test token for token-transfer verification,
 * extend submitToken() to run the native-fee preflight (sdk.nativeFeePreflight
 * -> fold FEE_DESTINATION into customOutputs), the same path the wallet's
 * composeForConfirm uses. Marked TODO below.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const SDK_PATH = process.env.XCHAIN_SDK_PATH
    || path.resolve(__dirname, '../../../xchain-sdk');
const { XChainSDK } = require(SDK_PATH);

const SSH = process.env.XCHAIN_REGTEST_SSH || 'devhost';
const NODE = process.env.XCHAIN_REGTEST_NODE || 'xchain-node-bitcoin-regtest-node';
const SDK_OPTS = {
    network: 'bitcoin-regtest',
    explorerUrl: 'localhost', explorerPort: Number(process.env.XCHAIN_REGTEST_EXPLORER_PORT || 18080),
    encoderUrl: 'localhost', encoderPort: Number(process.env.XCHAIN_REGTEST_ENCODER_PORT || 3023),
    hubUrl: 'localhost', hubPort: Number(process.env.XCHAIN_REGTEST_HUB_PORT || 10000),
};
const CLI = ['docker', 'exec', NODE, 'bitcoin-cli', '-conf=/etc/bitcoin/bitcoin.conf', '-rpcport=18444'];

// bitcoin-cli reads rpc credentials from -conf server-side; nothing sensitive crosses the wire here.
function nodeRpc(args) {
    return execFileSync('ssh', [SSH, [...CLI, ...args].join(' ')], { encoding: 'utf8' }).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randTick(prefix) {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = prefix;
    for (let i = 0; i < 6; i++) s += L[Math.floor(Math.random() * L.length)];
    return s;
}

async function submit(sdk, label, action, params, signer) {
    // Explicit funding set: the tracker cannot resolve a raw pubkey to a
    // script, and since xchain-sdk 5b57555 the SDK no longer falls back
    // to `change` for address-based selection. sdk.submitAction forwards
    // `utxos` (but not `sourceAddress`) to create_tx, so fetch the
    // spender's set by address here, per leg (each prior leg's change is
    // confirmed by its waitForIndexer before the next fetch).
    const utxos = await sdk.getUTXOs(signer.address);
    const res = await sdk.submitAction(
        { action, params },
        { pubkey: signer.pubkeyHex, change: signer.address, utxos },
        { wif: signer.wif, waitForIndexer: true, requireValid: false, timeout: 120000, pollInterval: 2000 },
    );
    console.log(`  [${label}] txid=${res.txid} broadcast+confirmed`);
    return res;
}

async function main() {
    const sdk = new XChainSDK(SDK_OPTS);

    const A = sdk.wallet.generateKeyPair();
    const addrA = sdk.wallet.deriveAddress(A.publicKeyHex, { type: 'p2wpkh' });
    const B = sdk.wallet.generateKeyPair();
    const addrB = sdk.wallet.deriveAddress(B.publicKeyHex, { type: 'p2wpkh' });
    const signerA = { wif: A.wif, pubkeyHex: A.publicKeyHex, address: addrA };
    console.log('signer A:', addrA);
    console.log('target B:', addrB);

    const fundTx = nodeRpc(['sendtoaddress', addrA, '10']);
    console.log('funded A:', fundTx);
    nodeRpc(['-generate', '3']);
    await sleep(6000);

    // 1) LIST v0 create - a complete round-trip proving the compose/fund path.
    console.log('\n=== LIST v0 create ===');
    await submit(sdk, 'LIST', 'LIST', { VERSION: '0', TYPE: '2', ITEM: [addrB] }, signerA);
    await sleep(3000);
    const lists = await sdk.getLists(addrA, 'address').catch((e) => ({ error: e.message }));
    const listOk = lists && lists.data && lists.data.some((r) => r.status === 'valid');
    console.log('  read-back getLists(A) valid row:', listOk ? 'YES' : JSON.stringify(lists).slice(0, 200));

    // 2) FILE at the PC-28 computed ceiling - proves the encoding-aware
    // size math end-to-end: the encoder must ACCEPT a payload at exactly
    // maxPublicFileBytes (old flat cap was 7000), the decoder must not
    // drop the near-8192 compiled push, and the indexer must record the
    // action. The +1 control must be rejected AT ENCODE TIME (RangeError,
    // no funds spent) - that encode-side refusal is the failure mode the
    // wallet's picker/review checks exist to pre-empt.
    //
    // ENCODER IDENTITY (, FIXED 2026-07-25): the P2SH/P2WSH chunk
    // lane used to resolve the caller with bitcoin.address.fromBase58Check(
    // pubKey), so any payload past the OP_RETURN lane composed ONLY from a
    // base58 LEGACY address; the raw compressed pubkey the SDK/wallet flows
    // pass (and any bech32 source) crashed create_tx with "Non-base58
    // character". The encoder now resolves the gate HASH160 from a base58
    // address, a raw pubkey hex, OR a v0 bech32 P2WPKH address, so this leg
    // runs from a BECH32 signer with the RAW PUBKEY as identity - byte-for-byte
    // the wallet's own path, and the direct  regression guard.
    console.log('\n=== FILE at computed max (PC-28, bech32 signer / ) ===');
    const { maxPublicFileBytes } = await import(
        path.resolve(__dirname, '../../packages/core/src/flows/fileSizeLimits.js')
    );
    const F = sdk.wallet.generateKeyPair();
    const addrF = sdk.wallet.deriveAddress(F.publicKeyHex, { type: 'p2wpkh' });
    console.log('  bech32 FILE signer:', addrF, '(identity = raw pubkey hex)');
    nodeRpc(['sendtoaddress', addrF, '10']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    const fileMeta = { name: 'pc28.bin', type: 'application/octet-stream' };
    const fileCap = maxPublicFileBytes(fileMeta);
    console.log(`  computed max for ${fileMeta.name}: ${fileCap} bytes`);
    const fileParams = { VERSION: '0', NAME: fileMeta.name, TYPE: fileMeta.type };
    const fileRes = await sdk.submitAction(
        { action: 'FILE', params: fileParams },
        { pubkey: F.publicKeyHex, change: addrF, utxos: await sdk.getUTXOs(addrF), rawData: 'A'.repeat(fileCap) },
        { wif: F.wif, waitForIndexer: true, requireValid: false, timeout: 120000, pollInterval: 2000 },
    );
    const fileStatus = fileRes.indexed && (fileRes.indexed.status || fileRes.indexed.state);
    console.log(`  [FILE] txid=${fileRes.txid} encoding=${fileRes.encoding} indexed status=${fileStatus}`);
    let fileRejectOk = false;
    try {
        await sdk.submitAction(
            { action: 'FILE', params: fileParams },
            { pubkey: F.publicKeyHex, change: addrF, utxos: await sdk.getUTXOs(addrF), rawData: 'A'.repeat(fileCap + 1) },
            { wif: F.wif, waitForIndexer: false },
        );
        console.log('  [FILE+1] UNEXPECTED: encoder accepted an over-ceiling payload');
    } catch (e) {
        fileRejectOk = /too large|exceeds maximum/i.test(e && e.message || '');
        console.log(`  [FILE+1] rejected at encode time: ${fileRejectOk ? 'YES' : `UNEXPECTED (${e.message})`}`);
    }

    // 3) ISSUE - composes/broadcasts; indexes invalid without the XCHAIN fee (see LIMITATION).
    console.log('\n=== ISSUE (compose/broadcast path) ===');
    const tick = randTick('RT');
    await submit(sdk, 'ISSUE', 'ISSUE',
        { VERSION: '0', TICK: tick, MAX_SUPPLY: '1000000', MINT_SUPPLY: '1000000', DECIMALS: '0', DESCRIPTION: 'roundtrip token' },
        signerA);
    // TODO(native-fee): premine to A via nativeFeePreflight to make this valid and enable a real token SEND.

    // 4) SEND - composes/broadcasts through the shared buildSendPsbt/encoder path.
    console.log('\n=== SEND (compose/broadcast path) ===');
    await submit(sdk, 'SEND', 'SEND', { VERSION: '0', TICK: tick, AMOUNT: '100', DESTINATION: addrB }, signerA);

    // 5) SWEEP with a REAL moving balance (PC-34): XCHAIN is freely
    // MINTable on regtest by any address (no ISSUE fee), so a MINT gives
    // the sweeper an actual token balance AND the XCHAIN to pay the
    // SWEEP's own fee. The sweep must index VALID, and the read-back
    // must show the residual XCHAIN (mint minus the sweep fee) credited
    // to the destination with the source emptied - the first leg in
    // this driver where a token balance verifiably MOVES.
    console.log('\n=== MINT XCHAIN + SWEEP (PC-34) ===');
    const S = sdk.wallet.generateKeyPair();
    const addrS = sdk.wallet.deriveAddress(S.publicKeyHex, { type: 'p2wpkh' });
    const signerS = { wif: S.wif, pubkeyHex: S.publicKeyHex, address: addrS };
    console.log('  sweep signer S:', addrS);
    nodeRpc(['sendtoaddress', addrS, '5']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    await submit(sdk, 'MINT', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '100' }, signerS);
    await sleep(3000);
    const sweepRes = await submit(sdk, 'SWEEP', 'SWEEP', {
        VERSION: '0', DESTINATION: addrB, BALANCES: '1', OWNERSHIPS: '1',
        ORDERS: '0', SWAPS: '0', DISPENSERS: '0', MEMO: 'pc34 roundtrip',
    }, signerS);
    const sweepStatus = sweepRes.indexed && (sweepRes.indexed.status || sweepRes.indexed.state);
    console.log(`  [SWEEP] indexed status=${sweepStatus}`);
    await sleep(3000);
    const balOf = async (addr) => {
        const resp = await sdk.getBalances(addr).catch(() => null);
        const rows = resp && Array.isArray(resp.data) ? resp.data : [];
        const row = rows.find((r) => r.tick === 'XCHAIN');
        return row ? String(row.quantity ?? row.amount ?? '0') : '0';
    };
    const balS = await balOf(addrS);
    const balB = await balOf(addrB);
    console.log(`  read-back: S XCHAIN=${balS} (want 0), B XCHAIN=${balB} (want >0 = mint minus sweep fee)`);
    const sweepOk = sweepStatus === 'valid' && Number(balS) === 0 && Number(balB) > 0;

    // 6) CALLBACK config (ISSUE v4) + execution (PC-03). Full chain, all
    // funded by a free regtest XCHAIN MINT:
    //   MINT XCHAIN -> ISSUE a token -> ISSUE v4 sets the callback config
    //   while undistributed -> SEND distributes to a holder -> mine past
    //   CALLBACK_BLOCK -> CALLBACK force-recalls all supply and pays the
    //   holder CALLBACK_AMOUNT XCHAIN per unit.
    // Proves BOTH new flows: the v4 config edit (read back via getToken)
    // and the CALLBACK execution (holder loses the token, gains XCHAIN;
    // owner's supply is restored).
    console.log('\n=== CALLBACK config (ISSUE v4) + execution (PC-03) ===');
    const C = sdk.wallet.generateKeyPair();
    const addrC = sdk.wallet.deriveAddress(C.publicKeyHex, { type: 'p2wpkh' });
    const signerC = { wif: C.wif, pubkeyHex: C.publicKeyHex, address: addrC };
    const H = sdk.wallet.generateKeyPair();
    const addrH = sdk.wallet.deriveAddress(H.publicKeyHex, { type: 'p2wpkh' });
    console.log('  callback owner C:', addrC, '\n  holder H:', addrH);
    nodeRpc(['sendtoaddress', addrC, '5']);
    nodeRpc(['sendtoaddress', addrH, '2']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    // XCHAIN funds the ISSUE fee AND is the CALLBACK_TICK payout token.
    await submit(sdk, 'MINT', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '1000' }, signerC);
    await sleep(3000);
    const cbTick = randTick('CB');
    await submit(sdk, 'ISSUE', 'ISSUE',
        { VERSION: '0', TICK: cbTick, MAX_SUPPLY: '1000', MINT_SUPPLY: '1000', DECIMALS: '0', DESCRIPTION: 'callback token' },
        signerC);
    await sleep(3000);
    // Configure the callback while C is the sole holder (undistributed).
    const tipInfo = JSON.parse(nodeRpc(['getblockchaininfo']));
    const cbBlock = Number(tipInfo.blocks) + 2;
    await submit(sdk, 'ISSUE v4', 'ISSUE',
        { VERSION: '4', TICK: cbTick, CALLBACK_BLOCK: String(cbBlock), CALLBACK_TICK: 'XCHAIN', CALLBACK_AMOUNT: '1' },
        signerC);
    await sleep(3000);
    const cbTokenInfo = await sdk.getToken(cbTick).catch(() => null);
    const cbRow = Array.isArray(cbTokenInfo) ? cbTokenInfo[0] : cbTokenInfo;
    const cbConfigOk = cbRow && cbRow.callback
        && String(cbRow.callback.tick) === 'XCHAIN'
        && String(cbRow.callback.amount) === '1'
        && Number(cbRow.callback.block) === cbBlock;
    console.log(`  v4 config read-back: tick=${cbRow?.callback?.tick} amount=${cbRow?.callback?.amount} block=${cbRow?.callback?.block} -> ${cbConfigOk ? 'OK' : 'MISMATCH'}`);
    // Distribute: send 10 of the token to the holder.
    await submit(sdk, 'SEND', 'SEND', { VERSION: '0', TICK: cbTick, AMOUNT: '10', DESTINATION: addrH }, signerC);
    await sleep(3000);
    // Mine past CALLBACK_BLOCK, then execute.
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    const cbRes = await submit(sdk, 'CALLBACK', 'CALLBACK', { VERSION: '0', TICK: cbTick, MEMO: 'pc03 roundtrip' }, signerC);
    const cbStatus = cbRes.indexed && (cbRes.indexed.status || cbRes.indexed.state);
    console.log(`  [CALLBACK] indexed status=${cbStatus}`);
    await sleep(3000);
    const tickBalOf = async (addr, tk) => {
        const resp = await sdk.getBalances(addr).catch(() => null);
        const rows = resp && Array.isArray(resp.data) ? resp.data : [];
        const row = rows.find((r) => r.tick === tk);
        return row ? String(row.quantity ?? row.amount ?? '0') : '0';
    };
    const hTokenAfter = await tickBalOf(addrH, cbTick);   // holder's token recalled -> 0
    const hXchainAfter = await tickBalOf(addrH, 'XCHAIN'); // holder paid 10 XCHAIN
    const cTokenAfter = await tickBalOf(addrC, cbTick);   // owner supply restored -> 1000
    console.log(`  read-back: H ${cbTick}=${hTokenAfter} (want 0), H XCHAIN=${hXchainAfter} (want >=10), C ${cbTick}=${cTokenAfter} (want 1000)`);
    const callbackOk = cbStatus === 'valid' && cbConfigOk
        && Number(hTokenAfter) === 0 && Number(hXchainAfter) >= 10 && Number(cTokenAfter) === 1000;

    // 7) Access lists (ISSUE v5, PC-04): publish a TYPE=2 address LIST, then
    // bind it as the token's ALLOW_LIST via ISSUE v5, and read the binding
    // back off getToken. Reuses owner C (still holds the token + XCHAIN for
    // the fee after the callback).
    console.log('\n=== Access lists (ISSUE v5, PC-04) ===');
    await submit(sdk, 'LIST', 'LIST', { VERSION: '0', TYPE: '2', ITEM: [addrH] }, signerC);
    await sleep(3000);
    const cLists = await sdk.getLists(addrC, 'address').catch(() => null);
    const cListRows = cLists && Array.isArray(cLists.data) ? cLists.data : (Array.isArray(cLists) ? cLists : []);
    const addrListRow = cListRows
        .filter((r) => String(r.type) === '2' && String(r.status || 'valid') === 'valid')
        .sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0))[0];
    const allowListIdx = addrListRow ? String(addrListRow.action_index) : null;
    console.log(`  published TYPE=2 address list #${allowListIdx}`);
    let accessListOk = false;
    if (allowListIdx) {
        await submit(sdk, 'ISSUE v5', 'ISSUE', { VERSION: '5', TICK: cbTick, ALLOW_LIST: allowListIdx }, signerC);
        await sleep(3000);
        const alTokenInfo = await sdk.getToken(cbTick).catch(() => null);
        const alRow = Array.isArray(alTokenInfo) ? alTokenInfo[0] : alTokenInfo;
        accessListOk = alRow && alRow.lists && String(alRow.lists.allow) === allowListIdx;
        console.log(`  ISSUE v5 read-back: lists.allow=${alRow?.lists?.allow} (want ${allowListIdx}) -> ${accessListOk ? 'OK' : 'MISMATCH'}`);
    } else {
        console.log('  could not resolve the published list action_index; skipping v5 bind');
    }

    // 8) Pause / SLEEP (v1 tick, PC-05): owner C pauses cbTick indefinitely,
    // then resumes it. SLEEP is owner-gated (not allow-list-gated), and a
    // tick owner may always SLEEP again to resume. Reads the state back off
    // getSleeps between each step.
    console.log('\n=== Pause / SLEEP (v1 tick, PC-05) ===');
    const sleepStateOf = async () => {
        const resp = await sdk.getSleeps(cbTick, 'token').catch(() => null);
        const rows = (resp && Array.isArray(resp.data) ? resp.data : [])
            .filter((r) => String(r.status || 'valid') === 'valid')
            .sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0));
        return rows.length ? Number(rows[0].resume_block) : null;
    };
    const pauseRes = await submit(sdk, 'SLEEP pause', 'SLEEP', { VERSION: '1', RESUME_BLOCK: '-1', TICK: cbTick, MEMO: 'pause pc05' }, signerC);
    const pauseStatus = pauseRes.indexed && (pauseRes.indexed.status || pauseRes.indexed.state);
    await sleep(3000);
    const pausedRb = await sleepStateOf();
    console.log(`  [SLEEP pause] status=${pauseStatus}; state resume_block=${pausedRb} (want -1)`);
    await submit(sdk, 'SLEEP resume', 'SLEEP', { VERSION: '1', RESUME_BLOCK: '0', TICK: cbTick, MEMO: 'resume pc05' }, signerC);
    await sleep(3000);
    const resumedRb = await sleepStateOf();
    console.log(`  [SLEEP resume] state resume_block=${resumedRb} (want 0)`);
    const sleepOk = pauseStatus === 'valid' && pausedRb === -1 && resumedRb === 0;

    // 9) ORDER v0 create / v2 edit / v1 cancel (PC-17). Funded by a free
    // XCHAIN MINT, which both provides the escrowed GIVE balance and pays
    // the order fees. Two corrections this leg proves against the live
    // indexer (both were latent wallet bugs the dev-mock SDK hid):
    //   - EXPIRATION is a wall-clock Unix timestamp, NOT a block count.
    //     Create AND edit set a real FUTURE Unix timestamp; a block count
    //     (e.g. 144) is < BLOCK_TIME and would index invalid "EXPIRATION
    //     (past)". Both indexing valid is the direct regression guard.
    //   - Cancel is ORDER VERSION 1 (ORDER_ACTION_INDEX), NOT a separate
    //     CANCEL action with OFFER_ACTION_INDEX (which the real SDK rejects
    //     UNKNOWN_ACTION). The v1 cancel indexing valid + flipping
    //     current_status to 'cancelled' proves the corrected wire.
    // GET side is native BTC (empty GET_TICK) - also exercises the native
    // COINPay-settled lane; we never match it, so it just stays open.
    console.log('\n=== ORDER v0 create / v2 edit / v1 cancel (PC-17) ===');
    const O = sdk.wallet.generateKeyPair();
    const addrO = sdk.wallet.deriveAddress(O.publicKeyHex, { type: 'p2wpkh' });
    const signerO = { wif: O.wif, pubkeyHex: O.publicKeyHex, address: addrO };
    console.log('  order signer O:', addrO);
    nodeRpc(['sendtoaddress', addrO, '5']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    await submit(sdk, 'MINT for ORDER', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '500' }, signerO);
    await sleep(3000);
    // Future Unix timestamps derived from the node's own clock (regtest
    // block time tracks wall clock; mediantime is the safe lower bound the
    // indexer compares against).
    const chainNow = Number(JSON.parse(nodeRpc(['getblockchaininfo'])).mediantime);
    const createExp = String(chainNow + 30 * 86400);   // ~30 days out
    const editExp = String(chainNow + 7 * 86400);      // shortened to ~7 days
    const orderRes = await submit(sdk, 'ORDER v0 create', 'ORDER', {
        VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '100', GIVE_OWNERSHIP: '0',
        GET_COIN: 'BTC', GET_TICK: '', GET_AMOUNT: '0.00100000', GET_OWNERSHIP: '0',
        GET_ADDRESS: addrO, EXPIRATION: createExp, ALLOW_LIST: '', BLOCK_LIST: '', MEMO: 'pc17 roundtrip',
    }, signerO);
    const createStatus = orderRes.indexed && (orderRes.indexed.status || orderRes.indexed.state);
    console.log(`  [ORDER v0] indexed status=${createStatus} (want valid; a block-count EXPIRATION would be "past")`);
    await sleep(3000);
    const findMyOrder = async () => {
        const resp = await sdk.getOrders(addrO, 'address').catch(() => null);
        const rows = resp && Array.isArray(resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        const sorted = rows.slice().sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0));
        return sorted.length ? String(sorted[0].action_index) : null;
    };
    const orderIdx = await findMyOrder();
    // getAction(idx).state.status is the lifecycle field, but it does NOT
    // promptly reflect a cancel (the order_statuses 'cancelled' row lags /
    // is not read by that path). The order_edits / order_cancels tables ARE
    // immediate and authoritative, so the edit/cancel proof (and the wallet's
    // My Orders status derivation) keys off those, not state.status.
    const detail = orderIdx ? await sdk.getAction(String(orderIdx)).catch(() => null) : null;
    const openStatus = detail && detail.state ? detail.state.status : null;
    console.log(`  read-back order idx=${orderIdx} state.status=${openStatus} give_remaining=${detail?.state?.give_remaining} (want index + open + full escrow)`);

    let editStatus = null; let cancelStatus = null; let editRowExp = null; let cancelRowFound = false;
    if (orderIdx) {
        // v2 edit: shorten EXPIRATION to another FUTURE Unix timestamp.
        const editRes = await submit(sdk, 'ORDER v2 edit', 'ORDER',
            { VERSION: '2', ORDER_ACTION_INDEX: orderIdx, EXPIRATION: editExp, MEMO: 'pc17 edit' }, signerO);
        editStatus = editRes.indexed && (editRes.indexed.status || editRes.indexed.state);
        await sleep(3000);
        const edits = await sdk.getOrderEdits(addrO, 'address').catch(() => null);
        const editRow = (edits && Array.isArray(edits.data) ? edits.data : [])
            .find((r) => String(r.order_action_index) === orderIdx);
        editRowExp = editRow ? String(editRow.expiration) : null;
        console.log(`  [ORDER v2 edit] indexed status=${editStatus}; order_edits.expiration=${editRowExp} (want valid + ${editExp})`);
        // v1 cancel: ORDER_ACTION_INDEX, not a CANCEL action.
        const cancelRes = await submit(sdk, 'ORDER v1 cancel', 'ORDER',
            { VERSION: '1', ORDER_ACTION_INDEX: orderIdx, MEMO: 'pc17 cancel' }, signerO);
        cancelStatus = cancelRes.indexed && (cancelRes.indexed.status || cancelRes.indexed.state);
        await sleep(3000);
        const cancels = await sdk.getOrderCancels(addrO, 'address').catch(() => null);
        cancelRowFound = (cancels && Array.isArray(cancels.data) ? cancels.data : [])
            .some((r) => String(r.order_action_index) === orderIdx && String(r.status || 'valid') === 'valid');
        console.log(`  [ORDER v1 cancel] indexed status=${cancelStatus}; order_cancels row for #${orderIdx}=${cancelRowFound} (want valid + true)`);
    }
    const orderOk = createStatus === 'valid' && orderIdx != null && openStatus === 'open'
        && editStatus === 'valid' && editRowExp === editExp
        && cancelStatus === 'valid' && cancelRowFound === true;

    // 10) SWAP v0 create / v2 edit / v1 cancel (PC-18). SWAP is token-for-
    // token (no native coin), so the signer MINTs free XCHAIN (the GIVE
    // side + the ISSUE/SWAP fees) and ISSUEs a token to name on the GET
    // side; we never match it, so the swap just sits open. Proves the same
    // EXPIRATION-is-Unix + cancel-is-v1/edit-is-v2 semantics as ORDER, on
    // the SWAP action's own tables (swap_edits / swap_cancels).
    console.log('\n=== SWAP v0 create / v2 edit / v1 cancel (PC-18) ===');
    const W = sdk.wallet.generateKeyPair();
    const addrW = sdk.wallet.deriveAddress(W.publicKeyHex, { type: 'p2wpkh' });
    const signerW = { wif: W.wif, pubkeyHex: W.publicKeyHex, address: addrW };
    console.log('  swap signer W:', addrW);
    nodeRpc(['sendtoaddress', addrW, '5']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    await submit(sdk, 'MINT for SWAP', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '500' }, signerW);
    await sleep(3000);
    const swTick = randTick('SW');
    await submit(sdk, 'ISSUE swap-get', 'ISSUE',
        { VERSION: '0', TICK: swTick, MAX_SUPPLY: '1000', MINT_SUPPLY: '1000', DECIMALS: '0', DESCRIPTION: 'swap get token' },
        signerW);
    await sleep(3000);
    const swNow = Number(JSON.parse(nodeRpc(['getblockchaininfo'])).mediantime);
    const swCreateExp = String(swNow + 30 * 86400);
    const swEditExp = String(swNow + 7 * 86400);
    const swapRes = await submit(sdk, 'SWAP v0 create', 'SWAP', {
        VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '100', GIVE_OWNERSHIP: '0',
        GET_COIN: 'BTC', GET_TICK: swTick, GET_AMOUNT: '50', GET_OWNERSHIP: '0',
        GET_ADDRESS: addrW, EXPIRATION: swCreateExp, ALLOW_LIST: '', BLOCK_LIST: '', MEMO: 'pc18 roundtrip',
    }, signerW);
    const swCreateStatus = swapRes.indexed && (swapRes.indexed.status || swapRes.indexed.state);
    console.log(`  [SWAP v0] indexed status=${swCreateStatus} (want valid; a block-count EXPIRATION would be "past")`);
    await sleep(3000);
    const findMySwap = async () => {
        const resp = await sdk.getSwaps(addrW, 'address').catch(() => null);
        const rows = resp && Array.isArray(resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        const sorted = rows.slice().sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0));
        return sorted.length ? String(sorted[0].action_index) : null;
    };
    const swapIdx = await findMySwap();
    const swDetail = swapIdx ? await sdk.getAction(String(swapIdx)).catch(() => null) : null;
    const swOpenStatus = swDetail && swDetail.state ? swDetail.state.status : null;
    console.log(`  read-back swap idx=${swapIdx} state.status=${swOpenStatus} (want index + open)`);

    let swEditStatus = null; let swEditRowExp = null; let swCancelStatus = null; let swCancelRowFound = false;
    if (swapIdx) {
        const swEditRes = await submit(sdk, 'SWAP v2 edit', 'SWAP',
            { VERSION: '2', SWAP_ACTION_INDEX: swapIdx, EXPIRATION: swEditExp, MEMO: 'pc18 edit' }, signerW);
        swEditStatus = swEditRes.indexed && (swEditRes.indexed.status || swEditRes.indexed.state);
        await sleep(3000);
        const swEdits = await sdk.getSwapEdits(addrW, 'address').catch(() => null);
        const swEditRow = (swEdits && Array.isArray(swEdits.data) ? swEdits.data : [])
            .find((r) => String(r.swap_action_index) === swapIdx);
        swEditRowExp = swEditRow ? String(swEditRow.expiration) : null;
        console.log(`  [SWAP v2 edit] indexed status=${swEditStatus}; swap_edits.expiration=${swEditRowExp} (want valid + ${swEditExp})`);
        const swCancelRes = await submit(sdk, 'SWAP v1 cancel', 'SWAP',
            { VERSION: '1', SWAP_ACTION_INDEX: swapIdx, MEMO: 'pc18 cancel' }, signerW);
        swCancelStatus = swCancelRes.indexed && (swCancelRes.indexed.status || swCancelRes.indexed.state);
        await sleep(3000);
        const swCancels = await sdk.getSwapCancels(addrW, 'address').catch(() => null);
        swCancelRowFound = (swCancels && Array.isArray(swCancels.data) ? swCancels.data : [])
            .some((r) => String(r.swap_action_index) === swapIdx && String(r.status || 'valid') === 'valid');
        console.log(`  [SWAP v1 cancel] indexed status=${swCancelStatus}; swap_cancels row for #${swapIdx}=${swCancelRowFound} (want valid + true)`);
    }
    const swapOk = swCreateStatus === 'valid' && swapIdx != null && swOpenStatus === 'open'
        && swEditStatus === 'valid' && swEditRowExp === swEditExp
        && swCancelStatus === 'valid' && swCancelRowFound === true;

    // 11) DISPENSER v0 token-priced create (PC-20). Proves the two field-set
    // additions that are new at CREATE: a TOKEN-priced lane (GET_TICK +
    // GET_AMOUNT, vs the coin-only lane the form had) and a Unix EXPIRATION
    // (block counts would index "past"). MINT XCHAIN gives the dispensed
    // token + fees; ISSUE a second token to name on the GET (payment) side.
    console.log('\n=== DISPENSER v0 token-priced create (PC-20) ===');
    const D = sdk.wallet.generateKeyPair();
    const addrD = sdk.wallet.deriveAddress(D.publicKeyHex, { type: 'p2wpkh' });
    const signerD = { wif: D.wif, pubkeyHex: D.publicKeyHex, address: addrD };
    console.log('  dispenser signer D:', addrD);
    nodeRpc(['sendtoaddress', addrD, '5']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    await submit(sdk, 'MINT for DISPENSER', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '500' }, signerD);
    await sleep(3000);
    const dPayTick = randTick('DP');
    await submit(sdk, 'ISSUE pay-token', 'ISSUE',
        { VERSION: '0', TICK: dPayTick, MAX_SUPPLY: '1000', MINT_SUPPLY: '1000', DECIMALS: '0', DESCRIPTION: 'dispenser pay token' },
        signerD);
    await sleep(3000);
    const dNow = Number(JSON.parse(nodeRpc(['getblockchaininfo'])).mediantime);
    const dExp = String(dNow + 30 * 86400);
    const dispRes = await submit(sdk, 'DISPENSER v0 (token-priced)', 'DISPENSER', {
        VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '10', GIVE_ESCROW: '100',
        GET_COIN: 'BTC', GET_TICK: dPayTick, GET_AMOUNT: '5', EXPIRATION: dExp, MEMO: 'pc20 token-priced',
    }, signerD);
    const dCreateStatus = dispRes.indexed && (dispRes.indexed.status || dispRes.indexed.state);
    console.log(`  [DISPENSER v0] indexed status=${dCreateStatus} (want valid; a block-count EXPIRATION would be "past")`);
    await sleep(3000);
    const dispRows = await sdk.getDispensers(addrD, 'address').catch(() => null);
    const dRows = dispRows && Array.isArray(dispRows.data) ? dispRows.data : (Array.isArray(dispRows) ? dispRows : []);
    const dRow = dRows.slice().sort((a, b) => Number(b.action_index || 0) - Number(a.action_index || 0))[0];
    const dGetTick = dRow ? String(dRow.get_tick || '') : '';
    // The getDispensers LIST projection omits expiration; read it off the
    // per-action detail (getAction) instead, like the ORDER leg.
    const dAction = dRow ? await sdk.getAction(String(dRow.action_index)).catch(() => null) : null;
    const dDetail = dAction && dAction.data && !Array.isArray(dAction.data) ? dAction.data : dAction;
    const dRowExp = dDetail ? String((dDetail.state && dDetail.state.expiration) || dDetail.expiration || '') : '';
    console.log(`  read-back dispenser give_tick=${dRow?.give_tick} get_tick=${dGetTick} expiration=${dRowExp} (want XCHAIN / ${dPayTick} / ${dExp})`);
    const dispOk = dCreateStatus === 'valid' && dRow != null
        && String(dRow.give_tick) === 'XCHAIN' && dGetTick === dPayTick && dRowExp === dExp;

    // 12) ADDRESS v0 preferences (PC-32). Non-default values on all three
    // fields so the read-back proves real writes, not defaults: destroy-fee
    // (1), memo-required (1), anyone-may-dispense (2). Read-back replays the
    // consensus fold the wallet's currentAddressPreferences mirrors.
    console.log('\n=== ADDRESS v0 preferences (PC-32) ===');
    const addrRes = await submit(sdk, 'ADDRESS v0 prefs', 'ADDRESS', {
        VERSION: '0', FEE_PREFERENCE: '1', REQUIRE_MEMO: '1', DISPENSER_PREFERENCE: '2', MEMO: 'pc32 prefs',
    }, signerD);
    const aStatus = addrRes.indexed && (addrRes.indexed.status || addrRes.indexed.state);
    console.log(`  [ADDRESS v0] indexed status=${aStatus} (want valid)`);
    await sleep(3000);
    const aResp = await sdk.getAddresses(addrD, 'address').catch(() => null);
    const aRows = (aResp && Array.isArray(aResp.data) ? aResp.data : (Array.isArray(aResp) ? aResp : []))
        .filter((r) => String(r.status || '') === 'valid')
        .sort((x, y) => Number(x.action_index || 0) - Number(y.action_index || 0));
    const aLast = aRows.length ? aRows[aRows.length - 1] : null;
    console.log(`  read-back fold: fee=${aLast?.fee_preference} require_memo=${aLast?.require_memo} dispenser=${aLast?.dispenser_preference} (want 1/1/2)`);
    const addrOk = aStatus === 'valid' && aLast != null
        && Number(aLast.fee_preference) === 1
        && Number(aLast.require_memo) === 1
        && Number(aLast.dispenser_preference) === 2;

    console.log('\nDONE. LIST + max-size FILE + balance-moving SWEEP + callback config/execution + v5 access-list bind + tick pause/resume + ORDER create/edit/cancel are the indexed proofs; ISSUE/SEND prove compose+broadcast.');
    const fileOk = fileStatus === 'valid' && fileRejectOk;
    console.log(listOk && fileOk && sweepOk && callbackOk && accessListOk && sleepOk && orderOk && swapOk && dispOk && addrOk
        ? 'RESULT: PASS (LIST + max-size FILE + over-ceiling reject + SWEEP + CALLBACK config/exec + ISSUE v5 access-list + SLEEP pause/resume + ORDER create/edit/cancel + SWAP create/edit/cancel + DISPENSER token-priced create + ADDRESS v0 prefs)'
        : `RESULT: CHECK (listOk=${listOk} fileStatus=${fileStatus} fileRejectOk=${fileRejectOk} sweepOk=${sweepOk} callbackOk=${callbackOk} accessListOk=${accessListOk} sleepOk=${sleepOk} orderOk=${orderOk} swapOk=${swapOk} dispOk=${dispOk} addrOk=${addrOk} aStatus=${aStatus})`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e && e.stack ? e.stack : e); process.exit(1); });
