import { Buffer } from "node:buffer";

export const ID_CHOKE = 0;
export const ID_UNCHOKE = 1;
export const ID_INTERESTED = 2;
export const ID_NOT_INTERESTED = 3;
export const ID_HAVE = 4;
export const ID_BITFIELD = 5;
export const ID_REQUEST = 6;
export const ID_PIECE = 7;
export const ID_CANCEL = 8;
export const ID_PORT = 9;

export const INFO_HASH_LENGTH = 20;
export const INTEGER_LENGTH = 4;
export const MESSAGE_ID_LENGTH = 1;
export const PEER_ID_LENGTH = 20;
export const PORT_LENGTH = 2;
export const PROTOCOL = "BitTorrent protocol";
export const PROTOCOL_LENGTH = 1;
export const RESERVED_LENGTH = 8;

export function decodeHandshake(buffer) {
    const protocolLength = buffer.readUInt8();
    const protocol = buffer
        .subarray(PROTOCOL_LENGTH, PROTOCOL_LENGTH + protocolLength)
        .toString();
    const reserved = buffer.subarray(
        PROTOCOL_LENGTH + protocolLength,
        PROTOCOL_LENGTH + protocolLength + RESERVED_LENGTH
    );
    const infoHash = buffer.subarray(
        PROTOCOL_LENGTH + protocolLength + RESERVED_LENGTH,
        PROTOCOL_LENGTH + protocolLength + RESERVED_LENGTH + INFO_HASH_LENGTH
    );
    const peerID = buffer.subarray(
        PROTOCOL_LENGTH + protocolLength + RESERVED_LENGTH + INFO_HASH_LENGTH,
        PROTOCOL_LENGTH +
            protocolLength +
            RESERVED_LENGTH +
            INFO_HASH_LENGTH +
            PEER_ID_LENGTH
    );

    return {
        protocolLength,
        protocol,
        reserved,
        infoHash,
        peerID,
    };
}

export function decodeHave(buffer) {
    const pieceIndex = buffer.readUInt32BE(INTEGER_LENGTH + MESSAGE_ID_LENGTH);

    return pieceIndex;
}

export function decodeBitfield(buffer) {
    const messageLength = buffer.readUInt32BE();
    const bitfieldLength = messageLength - MESSAGE_ID_LENGTH;

    return buffer.subarray(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH,
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + bitfieldLength
    );
}

export function decodeRequest(buffer) {
    const pieceIndex = buffer.readUInt32BE(INTEGER_LENGTH + MESSAGE_ID_LENGTH);
    const begin = buffer.readUInt32BE(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH
    );
    const length = buffer.readUInt32BE(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH
    );

    return { pieceIndex, begin, length };
}

export function decodePiece(buffer) {
    const messageLength = buffer.readUInt32BE();
    const pieceIndex = buffer.readUInt32BE(INTEGER_LENGTH + MESSAGE_ID_LENGTH);
    const begin = buffer.readUInt32BE(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH
    );
    const blockLength =
        messageLength - MESSAGE_ID_LENGTH - INTEGER_LENGTH - INTEGER_LENGTH;
    const blockOffset =
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH;
    const block = buffer.subarray(blockOffset, blockOffset + blockLength);

    return { pieceIndex, begin, block };
}

export function decodeCancel(buffer) {
    const pieceIndex = buffer.readUInt32BE(INTEGER_LENGTH + MESSAGE_ID_LENGTH);
    const begin = buffer.readUInt32BE(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH
    );
    const length = buffer.readUInt32BE(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH
    );

    return { pieceIndex, begin, length };
}

export function decodePort(buffer) {
    return buffer.readUInt16BE(INTEGER_LENGTH + MESSAGE_ID_LENGTH);
}

export function encodeHandshake(infoHash, peerID) {
    const buffer = Buffer.alloc(
        PROTOCOL_LENGTH +
            PROTOCOL.length +
            RESERVED_LENGTH +
            INFO_HASH_LENGTH +
            PEER_ID_LENGTH
    );

    let next = buffer.writeUInt8(PROTOCOL.length);
    next += buffer.write(PROTOCOL, next);
    next = buffer.writeBigUInt64BE(1n, next);
    next += infoHash.copy(buffer, next);
    peerID.copy(buffer, next);

    return buffer;
}

export function encodeKeepAlive() {
    return Buffer.alloc(INTEGER_LENGTH);
}

export function encodeChoke() {
    const buffer = Buffer.alloc(INTEGER_LENGTH + MESSAGE_ID_LENGTH);

    const next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH);
    buffer.writeUInt8(ID_CHOKE, next);

    return buffer;
}

export function encodeUnchoke() {
    const buffer = Buffer.alloc(INTEGER_LENGTH + MESSAGE_ID_LENGTH);

    const next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH);
    buffer.writeUInt8(ID_UNCHOKE, next);

    return buffer;
}

export function encodeInterested() {
    const buffer = Buffer.alloc(INTEGER_LENGTH + MESSAGE_ID_LENGTH);

    const next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH);
    buffer.writeUInt8(ID_INTERESTED, next);

    return buffer;
}

export function encodeNotInterested() {
    const buffer = Buffer.alloc(INTEGER_LENGTH + MESSAGE_ID_LENGTH);

    const next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH);
    buffer.writeUInt8(ID_NOT_INTERESTED, next);

    return buffer;
}

export function encodeHave(pieceIndex) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + INTEGER_LENGTH
    );

    let next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH + INTEGER_LENGTH);
    next = buffer.writeUInt8(ID_HAVE, next);
    buffer.writeUInt32BE(pieceIndex, next);

    return buffer;
}

export function encodeBitfield(bitfield) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + bitfield.length
    );

    let next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH + bitfield.length);
    next = buffer.writeUInt8(ID_BITFIELD, next);
    bitfield.copy(buffer, next);

    return buffer;
}

export function encodeRequest(pieceIndex, begin, length) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH +
            MESSAGE_ID_LENGTH +
            INTEGER_LENGTH +
            INTEGER_LENGTH +
            INTEGER_LENGTH
    );

    let next = buffer.writeUInt32BE(
        MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH
    );
    next = buffer.writeUInt8(ID_REQUEST, next);
    next = buffer.writeUInt32BE(pieceIndex, next);
    next = buffer.writeUInt32BE(begin, next);
    buffer.writeUInt32BE(length, next);

    return buffer;
}

export function encodePiece(pieceIndex, begin, block) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH +
            MESSAGE_ID_LENGTH +
            INTEGER_LENGTH +
            INTEGER_LENGTH +
            block.length
    );

    let next = buffer.writeUInt32BE(
        MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH + block.length
    );
    next = buffer.writeUInt8(ID_PIECE, next);
    next = buffer.writeUInt32BE(pieceIndex, next);
    next = buffer.writeUInt32BE(begin, next);
    block.copy(buffer, next);

    return buffer;
}

export function encodeCancel(pieceIndex, begin, length) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH +
            MESSAGE_ID_LENGTH +
            INTEGER_LENGTH +
            INTEGER_LENGTH +
            INTEGER_LENGTH
    );

    let next = buffer.writeUInt32BE(
        MESSAGE_ID_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH + INTEGER_LENGTH
    );
    next = buffer.writeUInt8(ID_CANCEL, next);
    next = buffer.writeUInt32BE(pieceIndex, next);
    next = buffer.writeUInt32BE(begin, next);
    buffer.writeUInt32BE(length, next);

    return buffer;
}

export function encodePort(port) {
    const buffer = Buffer.alloc(
        INTEGER_LENGTH + MESSAGE_ID_LENGTH + PORT_LENGTH
    );

    let next = buffer.writeUInt32BE(MESSAGE_ID_LENGTH + PORT_LENGTH);
    next = buffer.writeUInt8(ID_PORT, next);
    buffer.writeUInt16BE(port, next);

    return buffer;
}
