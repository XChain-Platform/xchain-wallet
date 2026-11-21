import Foundation

private struct KindSurface: Decodable {
    let kinds: [String]
}

@main
struct AlertKindLabelCheck {
    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data("AlertKindLabelCheck: \(message)\n".utf8))
        exit(1)
    }

    private static func decode<T: Decodable>(_ type: T.Type, at path: String) -> T {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try JSONDecoder().decode(type, from: data)
        } catch {
            fail("could not read \(path): \(error)")
        }
    }

    static func main() {
        let kindSurfaces = decode(
            [String: KindSurface].self,
            at: "packages/core/src/watch/contract/kinds.json"
        )
        let stringSurfaces = decode(
            [String: String].self,
            at: "packages/core/src/watch/contract/strings-surfaces.json"
        )
        let contractKinds = Set(kindSurfaces.values.flatMap(\.kinds))

        for kind in contractKinds.sorted() where AlertKindLabel.keys[kind] == nil {
            fail("missing mapping for kind \(kind)")
        }

        for kind in AlertKindLabel.keys.keys.sorted() where !contractKinds.contains(kind) {
            fail("unexpected mapping for kind \(kind)")
        }

        for kind in contractKinds.sorted() {
            guard let key = AlertKindLabel.keys[kind] else {
                fail("missing mapping for kind \(kind)")
            }
            guard stringSurfaces[key] != nil else {
                fail("mapping for \(kind) names missing string key \(key)")
            }
        }

        let namedMappings = [
            "tx-confirmed": "n1.kind.txConfirmed",
            "coinpay-autopay-manual": "n1.kind.coinpayAutopayManual",
            "request": "n2.kind.request",
            "paydue": "n2.kind.paydue",
        ]
        for kind in namedMappings.keys.sorted() {
            let expected = namedMappings[kind]
            if AlertKindLabel.key(kind: kind) != expected {
                fail("mapping for \(kind) is not \(expected ?? "nil")")
            }
        }

        for kind in ["", "Tx-Confirmed", "unknown-kind"] where AlertKindLabel.key(kind: kind) != nil {
            fail("expected nil for kind \(kind.isEmpty ? "<empty>" : kind)")
        }
    }
}
