# Security tests

Adversarial input + abuse paths. Each test asserts the wallet refuses
or correctly handles a specific class of malformed / hostile input.

## Layout

```
test/security/
├── vault/         oversized blobs, malformed cipher tags, key-confusion
├── wif/           parser hardening (truncated, non-base58, wrong checksum)
├── injection/     prototype pollution, HTML/JSX in user-supplied labels
└── passwords/     KDF parameter rejection (non-Argon2 algorithms, tiny salt)
```

## Run

```bash
pnpm test:security
```
