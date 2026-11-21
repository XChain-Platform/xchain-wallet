import Foundation

@main
struct WatchFixtureFilesCheck {
    static func main() {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("WatchFixtureFilesCheck-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: root) }

        do {
            let sourceDirectory = root
                .appendingPathComponent("one", isDirectory: true)
                .appendingPathComponent("two", isDirectory: true)
                .appendingPathComponent("three", isDirectory: true)
                .appendingPathComponent("four", isDirectory: true)
                .appendingPathComponent("five", isDirectory: true)
            try fileManager.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
            let filePath = sourceDirectory.appendingPathComponent("FixtureTests.swift").path

            require(WatchFixtureFiles.directory(from: filePath) == nil, "directory without ancestor")

            let rootFixtures = root
                .appendingPathComponent("test", isDirectory: true)
                .appendingPathComponent("fixtures", isDirectory: true)
                .appendingPathComponent("watch", isDirectory: true)
            try fileManager.createDirectory(at: rootFixtures, withIntermediateDirectories: true)
            require(
                WatchFixtureFiles.directory(from: filePath)?.standardizedFileURL == rootFixtures.standardizedFileURL,
                "root fixture directory"
            )

            let nearerFixtures = root
                .appendingPathComponent("one", isDirectory: true)
                .appendingPathComponent("two", isDirectory: true)
                .appendingPathComponent("test", isDirectory: true)
                .appendingPathComponent("fixtures", isDirectory: true)
                .appendingPathComponent("watch", isDirectory: true)
            try fileManager.createDirectory(at: nearerFixtures, withIntermediateDirectories: true)
            require(
                WatchFixtureFiles.directory(from: filePath)?.standardizedFileURL == nearerFixtures.standardizedFileURL,
                "nearest fixture directory"
            )

            let snapshotB = Data("snapshot b".utf8)
            try snapshotB.write(to: rootFixtures.appendingPathComponent("snapshot-b.json"))
            try Data("snapshot a".utf8).write(to: rootFixtures.appendingPathComponent("snapshot-a.json"))
            try Data("detail x".utf8).write(to: rootFixtures.appendingPathComponent("detail-x.json"))
            try Data("notes".utf8).write(to: rootFixtures.appendingPathComponent("snapshot-notes.txt"))
            let expected = rootFixtures.appendingPathComponent("expected", isDirectory: true)
            try fileManager.createDirectory(at: expected, withIntermediateDirectories: true)
            try Data("nested".utf8).write(to: expected.appendingPathComponent("snapshot-z.json"))

            require(
                WatchFixtureFiles.names(prefix: "snapshot-", in: rootFixtures) == ["snapshot-a", "snapshot-b"],
                "snapshot names"
            )
            require(
                WatchFixtureFiles.names(prefix: "detail-", in: rootFixtures) == ["detail-x"],
                "detail names"
            )
            require(
                WatchFixtureFiles.names(prefix: "request-", in: rootFixtures).isEmpty,
                "empty request names"
            )
            require(
                try WatchFixtureFiles.data("snapshot-b", in: rootFixtures) == snapshotB,
                "fixture data"
            )

            do {
                _ = try WatchFixtureFiles.data("missing", in: rootFixtures)
                fail("missing fixture data")
            } catch {}
        } catch {
            fail("setup: \(error)")
        }
    }

    static func require(_ condition: @autoclosure () throws -> Bool, _ name: String) {
        do {
            if try !condition() {
                fail(name)
            }
        } catch {
            fail("\(name): \(error)")
        }
    }

    static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
