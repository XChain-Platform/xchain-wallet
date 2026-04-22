export {
    StorageBackend,
    InMemoryBackend,
    AbstractBackendMethodError,
} from './backend.js';

export {
    DOCUMENT_VERSION,
    emptyDocument,
    encodeDocument,
    decodeDocument,
} from './codec.js';

export { Vault, VaultStateError, VaultValidationError } from './Vault.js';
