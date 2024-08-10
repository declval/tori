import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { suite, test } from "node:test";
import * as udpTrackerMessage from "./udpTrackerMessage.js";

suite("udp tracker message", () => {
    test("decodes connect", () => {
        const buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);
        const connectionID = udpTrackerMessage.decodeConnect(buffer);

        assert.equal(connectionID, 1n);
    });

    test("decodes announce", () => {
        const buffer = Buffer.from([
            ...[0, 0, 0, 1],
            ...[0, 0, 1, 0],
            ...[0, 0, 1, 1],
            ...[1, 2, 3, 4],
            ...[0, 1],
            ...[5, 6, 7, 8],
            ...[1, 0],
        ]);
        const { interval, leechers, seeders, peers } =
            udpTrackerMessage.decodeAnnounce(buffer);

        assert.equal(interval, 1);
        assert.equal(leechers, 256);
        assert.equal(seeders, 257);
        assert.deepEqual(peers, [
            { ip: "1.2.3.4", port: 1 },
            { ip: "5.6.7.8", port: 256 },
        ]);
    });

    test("decodes scrape", () => {
        const buffer = Buffer.from([
            ...[0, 0, 0, 1],
            ...[0, 0, 1, 0],
            ...[0, 0, 1, 1],
            ...[0, 1, 0, 0],
            ...[0, 1, 0, 1],
            ...[0, 1, 1, 0],
        ]);
        const stats = udpTrackerMessage.decodeScrape(buffer);

        assert.deepEqual(stats, [
            { seeders: 1, completed: 256, leechers: 257 },
            { seeders: 65536, completed: 65537, leechers: 65792 },
        ]);
    });

    test("decodes error", () => {
        const buffer = Buffer.from([
            "a".charCodeAt(0),
            "b".charCodeAt(0),
            "c".charCodeAt(0),
        ]);
        const errorMessage = udpTrackerMessage.decodeError(buffer);

        assert.equal(errorMessage, "abc");
    });

    test("encodes connect", () => {
        assert.deepEqual(
            udpTrackerMessage.encodeConnect(1),
            Buffer.from([
                ...[0x00, 0x00, 0x04, 0x17, 0x27, 0x10, 0x19, 0x80],
                ...[0, 0, 0, 0],
                ...[0, 0, 0, 1],
            ])
        );
    });

    test("encodes announce", () => {
        assert.deepEqual(
            udpTrackerMessage.encodeAnnounce(
                1n,
                256,
                Buffer.alloc(20).fill(257),
                Buffer.alloc(20).fill(65536),
                65537n,
                65792n,
                65793n,
                udpTrackerMessage.EVENT_STARTED,
                16777216,
                16777217,
                1
            ),
            Buffer.from([
                ...[0, 0, 0, 0, 0, 0, 0, 1],
                ...[0, 0, 0, 1],
                ...[0, 0, 1, 0],
                ...[
                    257, 257, 257, 257, 257, 257, 257, 257, 257, 257, 257, 257,
                    257, 257, 257, 257, 257, 257, 257, 257,
                ],
                ...[
                    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
                    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
                    65536, 65536, 65536, 65536,
                ],
                ...[0, 0, 0, 0, 0, 1, 0, 1],
                ...[0, 0, 0, 0, 0, 1, 1, 0],
                ...[0, 0, 0, 0, 0, 1, 1, 1],
                ...[0, 0, 0, 2],
                ...[0, 0, 0, 0],
                ...[1, 0, 0, 0],
                ...[1, 0, 0, 1],
                ...[0, 1],
            ])
        );
    });

    test("encodes scrape", () => {
        const infoHashes = [
            Buffer.alloc(20).fill(257),
            Buffer.alloc(20).fill(65536),
            Buffer.alloc(20).fill(65537),
        ];

        assert.deepEqual(
            udpTrackerMessage.encodeScrape(1n, 256, infoHashes),
            Buffer.from([
                ...[0, 0, 0, 0, 0, 0, 0, 1],
                ...[0, 0, 0, 2],
                ...[0, 0, 1, 0],
                ...[
                    257, 257, 257, 257, 257, 257, 257, 257, 257, 257, 257, 257,
                    257, 257, 257, 257, 257, 257, 257, 257,
                ],
                ...[
                    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
                    65536, 65536, 65536, 65536, 65536, 65536, 65536, 65536,
                    65536, 65536, 65536, 65536,
                ],
                ...[
                    65537, 65537, 65537, 65537, 65537, 65537, 65537, 65537,
                    65537, 65537, 65537, 65537, 65537, 65537, 65537, 65537,
                    65537, 65537, 65537, 65537,
                ],
            ])
        );
    });
});
