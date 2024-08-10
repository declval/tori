import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { suite, test } from "node:test";
import * as message from "./message.js";

suite("message", () => {
    test("encodes handshake", () => {
        assert.deepEqual(
            message.encodeHandshake(
                Buffer.alloc(20).fill(1),
                Buffer.alloc(20).fill(2)
            ),
            Buffer.concat([
                Buffer.from([19]),
                Buffer.from("BitTorrent protocol"),
                Buffer.alloc(8),
                Buffer.alloc(20).fill(1),
                Buffer.alloc(20).fill(2),
            ])
        );
    });

    test("encodes keep alive", () => {
        assert.deepEqual(message.encodeKeepAlive(), Buffer.alloc(4));
    });

    test("encodes choke", () => {
        assert.deepEqual(message.encodeChoke(), Buffer.from([0, 0, 0, 1, 0]));
    });

    test("encodes unchoke", () => {
        assert.deepEqual(message.encodeUnchoke(), Buffer.from([0, 0, 0, 1, 1]));
    });

    test("encodes interested", () => {
        assert.deepEqual(
            message.encodeInterested(),
            Buffer.from([0, 0, 0, 1, 2])
        );
    });

    test("encodes not interested", () => {
        assert.deepEqual(
            message.encodeNotInterested(),
            Buffer.from([0, 0, 0, 1, 3])
        );
    });

    test("encodes have", () => {
        assert.deepEqual(
            message.encodeHave(1),
            Buffer.from([0, 0, 0, 5, 4, 0, 0, 0, 1])
        );
    });

    test("encodes bitfield", () => {
        assert.deepEqual(
            message.encodeBitfield(Buffer.alloc(32).fill(1)),
            Buffer.concat([
                Buffer.from([0, 0, 0, 33, 5]),
                Buffer.alloc(32).fill(1),
            ])
        );
    });

    test("encodes request", () => {
        assert.deepEqual(
            message.encodeRequest(1, 2 ** 14, 2 ** 14),
            Buffer.from([
                0,
                0,
                0,
                13,
                6,
                0,
                0,
                0,
                1,
                0,
                0,
                2 ** 6,
                0,
                0,
                0,
                2 ** 6,
                0,
            ])
        );
    });

    test("encodes piece", () => {
        const messageLengthBuffer = Buffer.alloc(4);
        messageLengthBuffer.writeUInt32BE(9 + 2 ** 14);

        assert.deepEqual(
            message.encodePiece(1, 2 ** 14, Buffer.alloc(2 ** 14).fill(1)),
            Buffer.concat([
                messageLengthBuffer,
                Buffer.from([7, 0, 0, 0, 1, 0, 0, 2 ** 6, 0]),
                Buffer.alloc(2 ** 14).fill(1),
            ])
        );
    });

    test("encodes cancel", () => {
        assert.deepEqual(
            message.encodeCancel(1, 2 ** 14, 2 ** 14),
            Buffer.from([
                0,
                0,
                0,
                13,
                8,
                0,
                0,
                0,
                1,
                0,
                0,
                2 ** 6,
                0,
                0,
                0,
                2 ** 6,
                0,
            ])
        );
    });

    test("encodes port", () => {
        assert.deepEqual(
            message.encodePort(80),
            Buffer.from([0, 0, 0, 3, 9, 0, 80])
        );
    });

    test("decodes handshake", () => {
        const { protocolLength, protocol, reserved, infoHash, peerID } =
            message.decodeHandshake(
                Buffer.concat([
                    Buffer.from([19]),
                    Buffer.from("BitTorrent protocol"),
                    Buffer.alloc(8),
                    Buffer.alloc(20).fill(1),
                    Buffer.alloc(20).fill(2),
                ])
            );

        assert.equal(protocolLength, 19);
        assert.equal(protocol, "BitTorrent protocol");
        assert.deepEqual(reserved, Buffer.alloc(8));
        assert.deepEqual(infoHash, Buffer.alloc(20).fill(1));
        assert.deepEqual(peerID, Buffer.alloc(20).fill(2));
    });

    test("decodes have", () => {
        const pieceIndex = message.decodeHave(
            Buffer.from([0, 0, 0, 5, 4, 0, 0, 0, 1])
        );

        assert.equal(pieceIndex, 1);
    });

    test("decodes bitfield", () => {
        const bitfield = message.decodeBitfield(
            Buffer.concat([
                Buffer.from([0, 0, 0, 33, 5]),
                Buffer.alloc(32).fill(1),
            ])
        );

        assert.deepEqual(bitfield, Buffer.alloc(32).fill(1));
    });

    test("decodes request", () => {
        const { pieceIndex, begin, length } = message.decodeRequest(
            Buffer.from([0, 0, 0, 13, 6, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3])
        );

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 2);
        assert.equal(length, 3);
    });

    test("decodes piece", () => {
        const { pieceIndex, begin, block } = message.decodePiece(
            Buffer.concat([
                Buffer.from([0, 0, 0, 41, 7, 0, 0, 0, 1, 0, 0, 0, 2]),
                Buffer.alloc(32).fill(1),
            ])
        );

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 2);
        assert.deepEqual(block, Buffer.alloc(32).fill(1));
    });

    test("decodes cancel", () => {
        const { pieceIndex, begin, length } = message.decodeRequest(
            Buffer.from([0, 0, 0, 13, 8, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3])
        );

        assert.equal(pieceIndex, 1);
        assert.equal(begin, 2);
        assert.equal(length, 3);
    });

    test("decodes port", () => {
        const port = message.decodePort(Buffer.from([0, 0, 0, 3, 9, 0, 80]));

        assert.equal(port, 80);
    });
});
