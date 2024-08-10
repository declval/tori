import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { suite, test } from "node:test";
import * as message from "./message.js";

suite("message", () => {
    test("decodes handshake", () => {
        const buffer = Buffer.from([
            ...[19],
            ...[..."BitTorrent protocol"].map((c) => c.charCodeAt(0)),
            ...[0, 0, 0, 0, 0, 0, 0, 0],
            ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
        ]);
        const {
            protocolLength,
            protocol,
            reserved,
            infoHash: receivedInfoHash,
            peerID: receivedPeerID,
        } = message.decodeHandshake(buffer);
        const infoHash = Buffer.from([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        ]);
        const peerID = Buffer.from([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
        ]);

        assert.equal(protocolLength, 19);
        assert.equal(protocol, "BitTorrent protocol");
        assert.deepEqual(reserved, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
        assert.deepEqual(receivedInfoHash, infoHash);
        assert.deepEqual(receivedPeerID, peerID);
    });

    test("decodes have", () => {
        const buffer = Buffer.from([...[0, 0, 0, 5], ...[4], ...[0, 0, 0, 1]]);
        const pieceIndex = message.decodeHave(buffer);

        assert.equal(pieceIndex, 1);
    });

    test("decodes bitfield", () => {
        const buffer = Buffer.from([...[0, 0, 0, 5], ...[5], ...[0, 0, 0, 1]]);
        const receivedBitfield = message.decodeBitfield(buffer);
        const bitfield = Buffer.from([0, 0, 0, 1]);

        assert.deepEqual(receivedBitfield, bitfield);
    });

    test("decodes request", () => {
        const buffer = Buffer.from([
            ...[0, 0, 0, 13],
            ...[6],
            ...[0, 0, 0, 1],
            ...[0, 0, 0, 0],
            ...[0, 0, 0, 4],
        ]);
        const { pieceIndex, begin, length } = message.decodeRequest(buffer);

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 0);
        assert.equal(length, 4);
    });

    test("decodes piece", () => {
        const buffer = Buffer.from([
            ...[0, 0, 0, 13],
            ...[7],
            ...[0, 0, 0, 1],
            ...[0, 0, 0, 0],
            ...[0, 0, 0, 1],
        ]);
        const { pieceIndex, begin, block } = message.decodePiece(buffer);

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 0);
        assert.deepEqual(block, Buffer.from([0, 0, 0, 1]));
    });

    test("decodes cancel", () => {
        const buffer = Buffer.from([
            ...[0, 0, 0, 13],
            ...[6],
            ...[0, 0, 0, 1],
            ...[0, 0, 0, 0],
            ...[0, 0, 0, 4],
        ]);
        const { pieceIndex, begin, length } = message.decodeRequest(buffer);

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 0);
        assert.equal(length, 4);
    });

    test("decodes port", () => {
        const buffer = Buffer.from([...[0, 0, 0, 3], ...[9], ...[0, 80]]);
        const port = message.decodePort(buffer);

        assert.equal(port, 80);
    });

    test("encodes handshake", () => {
        const infoHash = Buffer.from([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
        ]);
        const peerID = Buffer.from([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
        ]);

        assert.deepEqual(
            message.encodeHandshake(infoHash, peerID),
            Buffer.from([
                ...[19],
                ...[..."BitTorrent protocol"].map((c) => c.charCodeAt(0)),
                ...[0, 0, 0, 0, 0, 0, 0, 1],
                ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                ...[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
            ])
        );
    });

    test("encodes keep alive", () => {
        assert.deepEqual(message.encodeKeepAlive(), Buffer.from([0, 0, 0, 0]));
    });

    test("encodes choke", () => {
        assert.deepEqual(
            message.encodeChoke(),
            Buffer.from([...[0, 0, 0, 1], ...[0]])
        );
    });

    test("encodes unchoke", () => {
        assert.deepEqual(
            message.encodeUnchoke(),
            Buffer.from([...[0, 0, 0, 1], ...[1]])
        );
    });

    test("encodes interested", () => {
        assert.deepEqual(
            message.encodeInterested(),
            Buffer.from([...[0, 0, 0, 1], ...[2]])
        );
    });

    test("encodes not interested", () => {
        assert.deepEqual(
            message.encodeNotInterested(),
            Buffer.from([...[0, 0, 0, 1], ...[3]])
        );
    });

    test("encodes have", () => {
        const pieceIndex = 1;

        assert.deepEqual(
            message.encodeHave(pieceIndex),
            Buffer.from([...[0, 0, 0, 5], ...[4], ...[0, 0, 0, 1]])
        );
    });

    test("encodes bitfield", () => {
        const bitfield = Buffer.from([0, 0, 0, 1]);

        assert.deepEqual(
            message.encodeBitfield(bitfield),
            Buffer.from([...[0, 0, 0, 5], ...[5], ...[0, 0, 0, 1]])
        );
    });

    test("encodes request", () => {
        const pieceIndex = 1;
        const begin = 0;
        const length = 4;

        assert.deepEqual(
            message.encodeRequest(pieceIndex, begin, length),
            Buffer.from([
                ...[0, 0, 0, 13],
                ...[6],
                ...[0, 0, 0, 1],
                ...[0, 0, 0, 0],
                ...[0, 0, 0, 4],
            ])
        );
    });

    test("encodes piece", () => {
        const pieceIndex = 1;
        const begin = 0;
        const block = Buffer.from([0, 0, 1, 0]);

        assert.deepEqual(
            message.encodePiece(pieceIndex, begin, block),
            Buffer.from([
                ...[0, 0, 0, 13],
                ...[7],
                ...[0, 0, 0, 1],
                ...[0, 0, 0, 0],
                ...[0, 0, 1, 0],
            ])
        );
    });

    test("encodes cancel", () => {
        const pieceIndex = 1;
        const begin = 0;
        const length = 4;

        assert.deepEqual(
            message.encodeCancel(pieceIndex, begin, length),
            Buffer.from([
                ...[0, 0, 0, 13],
                ...[8],
                ...[0, 0, 0, 1],
                ...[0, 0, 0, 0],
                ...[0, 0, 0, 4],
            ])
        );
    });

    test("encodes port", () => {
        const port = 80;

        assert.deepEqual(
            message.encodePort(port),
            Buffer.from([...[0, 0, 0, 3], ...[9], ...[0, 80]])
        );
    });
});
