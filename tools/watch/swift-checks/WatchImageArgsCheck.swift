import CryptoKit
import Foundation

@main
enum WatchImageArgsCheck {
    private static var passed = 0

    static func main() {
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
        let jpeg = Data([0xff, 0xd8, 0xff, 0xe0, 0x01])
        let pngHash = sha256(png)

        check("PNG bytes decode") {
            decode(png, hash: pngHash) == png
        }
        check("JPEG bytes decode") {
            decode(jpeg, hash: sha256(jpeg)) == jpeg
        }
        check("uppercase hash is rejected") {
            decode(png, hash: pngHash.uppercased()) == nil
        }
        check("63-character hash is rejected") {
            decode(png, hash: String(pngHash.dropLast())) == nil
        }
        check("hash of other bytes is rejected") {
            decode(png, hash: sha256(Data("other bytes".utf8))) == nil
        }
        check("nil hash is rejected") {
            WatchImageArgs.decode(hash: nil, base64: png.base64EncodedString()) == nil
        }
        check("nil base64 is rejected") {
            WatchImageArgs.decode(hash: pngHash, base64: nil) == nil
        }
        check("invalid base64 is rejected") {
            WatchImageArgs.decode(hash: pngHash, base64: "%%%") == nil
        }
        check("empty base64 is rejected") {
            WatchImageArgs.decode(hash: sha256(Data()), base64: "") == nil
        }

        let gif = Data("GIF89a".utf8)
        check("GIF bytes are rejected") {
            decode(gif, hash: sha256(gif)) == nil
        }

        print("PASS: \(passed) checks")
    }

    private static func decode(_ data: Data, hash: String) -> Data? {
        WatchImageArgs.decode(hash: hash, base64: data.base64EncodedString())
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func check(_ name: String, _ condition: () -> Bool) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
