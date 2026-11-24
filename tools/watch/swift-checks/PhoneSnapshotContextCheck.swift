import Foundation

@main
enum PhoneSnapshotContextCheck {
    static func main() {
        let fixtures: [(String, [String: Any])] = loadFixtures()

        for (name, context) in fixtures {
            guard let first = PhoneSnapshotContext.read(context) else {
                fail("fixture accepted: \(name)")
            }
            guard let object = try? JSONSerialization.jsonObject(with: first),
                  NSDictionary(dictionary: context).isEqual(object) else {
                fail("fixture round trip: \(name)")
            }
            guard (try? JSONDecoder().decode(Snapshot.self, from: first)) != nil else {
                fail("fixture decodes: \(name)")
            }
            guard PhoneSnapshotContext.read(context) == first else {
                fail("fixture stable bytes: \(name)")
            }
        }

        guard let valid = fixtures.first?.1 else {
            fail("fixture list is empty")
        }

        requireNil([:], "empty context")
        requireNil(replacing("v", with: 2, in: valid), "v 2")
        requireNil(replacing("v", with: true, in: valid), "v true")
        requireNil(replacing("v", with: "1", in: valid), "v string")

        var missingVersion = valid
        missingVersion.removeValue(forKey: "v")
        requireNil(missingVersion, "missing v")
        requireNil(replacing("rows", with: "invalid", in: valid), "rows string")
        requireNil(replacing("date", with: Date(), in: valid), "Date value")
    }

    private static func loadFixtures() -> [(String, [String: Any])] {
        let directory = URL(fileURLWithPath: "test/fixtures/watch", isDirectory: true)
        let names: [String]

        do {
            names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
                .filter { $0.hasPrefix("snapshot-") && $0.hasSuffix(".json") }
                .sorted()
        } catch {
            fail("fixture directory")
        }

        return names.map { name in
            let url = directory.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: url),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let context = object as? [String: Any] else {
                fail("fixture parse: \(name)")
            }
            return (name, context)
        }
    }

    private static func replacing(
        _ key: String,
        with value: Any,
        in context: [String: Any]
    ) -> [String: Any] {
        var result = context
        result[key] = value
        return result
    }

    private static func requireNil(_ context: [String: Any], _ name: String) {
        guard PhoneSnapshotContext.read(context) == nil else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
