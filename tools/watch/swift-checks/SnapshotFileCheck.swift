import Foundation

@main
struct SnapshotFileCheck {
    static func main() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let snapshotFile = SnapshotFile(directory: directory)
        require(snapshotFile.load() == nil, "load before any save is nil")

        let first = Data("first snapshot".utf8)
        do {
            try snapshotFile.save(first)
        } catch {
            fail("save creates the directory and load returns the same bytes")
        }
        require(
            FileManager.default.fileExists(atPath: directory.path)
                && snapshotFile.load() == first,
            "save creates the directory and load returns the same bytes"
        )

        let second = Data("second snapshot".utf8)
        do {
            try snapshotFile.save(second)
        } catch {
            fail("a second save overwrites")
        }
        require(snapshotFile.load() == second, "a second save overwrites")

        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )
        } catch {
            fail("after two saves the directory holds only snapshot.json")
        }
        require(
            contents.map(\.lastPathComponent) == [SnapshotFile.fileName],
            "after two saves the directory holds only snapshot.json"
        )

        require(snapshotFile.wipe(), "wipe on a present file returns true")
        require(snapshotFile.load() == nil, "load after wipe is nil")
        require(snapshotFile.wipe(), "wipe on an absent file returns true")
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
