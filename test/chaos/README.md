# Chaos tests

Fault injection. The wallet must survive - gracefully - every plausible
runtime failure: backend rejects a write, network hangs, hardware
signer disconnects mid-flow, message handler throws, vendor SDK
returns malformed data.

Each chaos test wraps a real Wallet primitive (Vault / messaging
host / signer) with a fault-injecting decorator and asserts the
outer behaviour is correct: error surface is meaningful, prior
state is preserved, no zombie state machines.

## Layout

```
test/chaos/
├── backend/    save throws, load returns garbage, mid-flight failure
├── vault/      decryption failures, codec mismatch, schema drift
├── messaging/  slow handler, timeout, racy in-flight requests
└── signers/    vendor SDK throws, returns wrong shape, disconnects
```

## Run

```bash
pnpm test:chaos
```
