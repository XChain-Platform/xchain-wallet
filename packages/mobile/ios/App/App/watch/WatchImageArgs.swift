import CryptoKit
import Foundation

enum WatchImageArgs {
    static func decode(hash: String?, base64: String?) -> Data? {
        guard let hash,
              hash.utf8.count == 64,
              hash.utf8.allSatisfy({ byte in
                  (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
              }),
              let base64,
              let data = Data(base64Encoded: base64),
              !data.isEmpty,
              data.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
                  || data.starts(with: [0xff, 0xd8, 0xff]) else {
            return nil
        }

        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return digest == hash ? data : nil
    }
}
