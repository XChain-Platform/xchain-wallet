import Foundation

@main
enum WatchFileMetadataCheck {
    private static var passed = 0

    static func main() {
        checkRoundTrip(
            "detail bitcoin-mainnet:XC round trip",
            kind: "detail",
            key: "bitcoin-mainnet:XC"
        )
        checkRoundTrip(
            "detail bitcoin-mainnet:BTC round trip",
            kind: "detail",
            key: "bitcoin-mainnet:BTC"
        )
        checkRoundTrip(
            "image hash round trip",
            kind: "image",
            key: validImageHash
        )

        for kind in ["snapshot", "Image", ""] {
            check("metadata rejects kind \(display(kind))") {
                WatchFileMetadata.metadata(kind: kind, key: "key") == nil
            }
        }
        check("metadata rejects empty key") {
            WatchFileMetadata.metadata(kind: "detail", key: "") == nil
        }
        for invalidKey in invalidImageKeys {
            check("metadata rejects image key \(invalidKey.name)") {
                WatchFileMetadata.metadata(kind: "image", key: invalidKey.value) == nil
            }
        }

        check("read rejects nil metadata") {
            PhoneFileMetadata.read(nil) == nil
        }
        check("read rejects empty dictionary") {
            PhoneFileMetadata.read([:]) == nil
        }
        check("read rejects missing kind") {
            PhoneFileMetadata.read(["key": "key"]) == nil
        }
        check("read rejects missing key") {
            PhoneFileMetadata.read(["kind": "detail"]) == nil
        }
        check("read rejects a third key") {
            PhoneFileMetadata.read([
                "kind": "detail",
                "key": "key",
                "extra": true,
            ]) == nil
        }
        check("read rejects numeric kind") {
            PhoneFileMetadata.read(["kind": 1, "key": "key"]) == nil
        }
        check("read rejects numeric key") {
            PhoneFileMetadata.read(["kind": "detail", "key": 1]) == nil
        }
        check("read rejects unlisted kind") {
            PhoneFileMetadata.read(["kind": "snapshot", "key": "key"]) == nil
        }
        check("read rejects empty key") {
            PhoneFileMetadata.read(["kind": "detail", "key": ""]) == nil
        }
        for invalidKey in invalidImageKeys {
            check("read rejects image key \(invalidKey.name)") {
                PhoneFileMetadata.read(["kind": "image", "key": invalidKey.value]) == nil
            }
        }

        check("kinds equal PhoneFileKind raw values in order") {
            WatchFileMetadata.kinds == PhoneFileKind.allCases.map(\.rawValue)
        }
        checkWearImageHashRule()

        print("PASS: \(passed) checks")
    }

    private static let validImageHash = String(repeating: "a", count: 64)

    private static var invalidImageKeys: [(name: String, value: String)] {
        [
            ("63 lowercase hex characters", String(repeating: "a", count: 63)),
            ("65 lowercase hex characters", String(repeating: "a", count: 65)),
            ("uppercase hex", String(repeating: "A", count: 64)),
            ("path traversal", "../" + String(repeating: "a", count: 61)),
            ("png suffix", validImageHash + ".png"),
            ("fixture placeholder", "btc-icon-cache"),
        ]
    }

    private static func checkRoundTrip(_ name: String, kind: String, key: String) {
        check(name) {
            guard let metadata = WatchFileMetadata.metadata(kind: kind, key: key),
                  metadata.count == 2,
                  metadata["kind"] == kind,
                  metadata["key"] == key,
                  let read = PhoneFileMetadata.read(metadata),
                  read.kind.rawValue == kind,
                  read.key == key else {
                return false
            }

            return true
        }
    }

    private static func checkWearImageHashRule() {
        let path = "packages/mobile/android/wear/src/main/java/io/xchain/wallet/android/wear/data/WatchPaths.java"

        do {
            let source = try String(contentsOfFile: path, encoding: .utf8)
            check("Wear image hash rule remains aligned") {
                source.contains("Pattern.compile(\"[0-9a-f]{64}\")")
            }
        } catch {
            fail("could not read \(path): \(error)")
        }
    }

    private static func check(_ name: String, _ condition: () -> Bool) {
        guard condition() else {
            fail(name)
        }
        passed += 1
    }

    private static func display(_ value: String) -> String {
        value.isEmpty ? "<empty>" : value
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
