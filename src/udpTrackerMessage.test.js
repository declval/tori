import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { suite, test } from "node:test";
import * as udpTrackerMessage from "./udpTrackerMessage.js";

suite("udp tracker message", () => {
    test("encodes connect", () => {
        assert.deepEqual(
            udpTrackerMessage.encodeConnect(123),
            Buffer.concat([
                Buffer.from([0, 0, 0x04, 0x17, 0x27, 0x10, 0x19, 0x80]),
                Buffer.alloc(4),
                Buffer.from([0, 0, 0, 0x7b]),
            ])
        );
    });

    test("encodes announce", () => {
        const connectionID = Buffer.alloc(8);
        connectionID.writeBigUInt64BE(123n);

        const actionAnnounce = Buffer.alloc(4);
        actionAnnounce.writeUInt32BE(udpTrackerMessage.ACTION_ANNOUNCE);

        const transactionID = Buffer.alloc(4);
        transactionID.writeUInt32BE(456);

        const downloaded = Buffer.alloc(8);
        downloaded.writeBigUInt64BE(100n);

        const left = Buffer.alloc(8);
        left.writeBigUInt64BE(200n);

        const uploaded = Buffer.alloc(8);
        uploaded.writeBigUInt64BE(300n);

        const event = Buffer.alloc(4);
        event.writeUInt32BE(udpTrackerMessage.EVENT_STARTED);

        const ip = Buffer.alloc(4);

        const key = Buffer.alloc(4);
        key.writeUInt32BE(400);

        const numWant = Buffer.alloc(4);
        numWant.writeUInt32BE(500);

        const port = Buffer.alloc(2);
        port.writeUInt16BE(600);

        assert.deepEqual(
            udpTrackerMessage.encodeAnnounce(
                123n,
                456,
                Buffer.alloc(20).fill(1),
                Buffer.alloc(20).fill(2),
                100n,
                200n,
                300n,
                udpTrackerMessage.EVENT_STARTED,
                400,
                500,
                600
            ),
            Buffer.concat([
                connectionID,
                actionAnnounce,
                transactionID,
                Buffer.alloc(20).fill(1),
                Buffer.alloc(20).fill(2),
                downloaded,
                left,
                uploaded,
                event,
                ip,
                key,
                numWant,
                port,
            ])
        );
    });

    test("encodes scrape", () => {
        const connectionID = Buffer.alloc(8);
        connectionID.writeBigUInt64BE(123n);

        const actionScrape = Buffer.alloc(4);
        actionScrape.writeUInt32BE(udpTrackerMessage.ACTION_SCRAPE);

        const transactionID = Buffer.alloc(4);
        transactionID.writeUInt32BE(456);

        const infoHashes = [
            Buffer.alloc(20).fill(1),
            Buffer.alloc(20).fill(2),
            Buffer.alloc(20).fill(3),
        ];

        assert.deepEqual(
            udpTrackerMessage.encodeScrape(123n, 456, infoHashes),
            Buffer.concat([
                connectionID,
                actionScrape,
                transactionID,
                Buffer.alloc(20).fill(1),
                Buffer.alloc(20).fill(2),
                Buffer.alloc(20).fill(3),
            ])
        );
    });
});

suite("udp tracker message", () => {
    //test("decodes connect", () => {
    //    assert.deepEqual(
    //        udpTrackerMessage.decodeConnect(),
    //        Buffer.concat([Buffer.from([19])])
    //    );
    //});
    //
    //test("decodes announce", () => {
    //    assert.deepEqual(udpTrackerMessage.decodeAnnounce(), Buffer.alloc(4));
    //});
    //
    //test("decodes scrape", () => {
    //    assert.deepEqual(
    //        udpTrackerMessage.decodeScape(),
    //        Buffer.from([0, 0, 0, 1, 0])
    //    );
    //});
    //
    //test("decodes error", () => {
    //    assert.deepEqual(
    //        udpTrackerMessage.decodeError(),
    //        Buffer.from([0, 0, 0, 1, 0])
    //    );
    //});
});
