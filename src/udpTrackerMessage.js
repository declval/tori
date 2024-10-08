import { Buffer } from "node:buffer";

export const ACTION_CONNECT = 0;
export const ACTION_ANNOUNCE = 1;
export const ACTION_SCRAPE = 2;
export const ACTION_ERROR = 3;

export const EVENT_NONE = 0;
export const EVENT_COMPLETED = 1;
export const EVENT_STARTED = 2;
export const EVENT_STOPPED = 3;

export const ACTION_LENGTH = 4;
export const CONNECTION_ID_LENGTH = 8;
export const DOWNLOADED_LENGTH = 8;
export const EVENT_LENGTH = 4;
export const INFO_HASH_LENGTH = 20;
export const INTERVAL_LENGTH = 4;
export const IP_LENGTH = 4;
export const KEY_LENGTH = 4;
export const LEECHERS_LENGTH = 4;
export const LEFT_LENGTH = 8;
export const NUM_WANT_LENGTH = 4;
export const PEER_ID_LENGTH = 20;
export const PORT_LENGTH = 2;
export const PROTOCOL_ID_LENGTH = 8;
export const SEEDERS_LENGTH = 4;
export const TRANSACTION_ID_LENGTH = 4;
export const UPLOADED_LENGTH = 8;

export function encodeConnect(transactionID) {
    const buffer = Buffer.alloc(
        PROTOCOL_ID_LENGTH + ACTION_LENGTH + TRANSACTION_ID_LENGTH
    );

    let next = buffer.writeBigUInt64BE(0x41727101980n);

    next = buffer.writeUInt32BE(ACTION_CONNECT, next);

    buffer.writeUInt32BE(transactionID, next);

    return buffer;
}

export function encodeAnnounce(
    connectionID,
    transactionID,
    infoHash,
    peerID,
    downloaded,
    left,
    uploaded,
    event,
    key,
    numWant,
    port
) {
    const buffer = Buffer.alloc(
        CONNECTION_ID_LENGTH +
            ACTION_LENGTH +
            TRANSACTION_ID_LENGTH +
            INFO_HASH_LENGTH +
            PEER_ID_LENGTH +
            DOWNLOADED_LENGTH +
            LEFT_LENGTH +
            UPLOADED_LENGTH +
            EVENT_LENGTH +
            IP_LENGTH +
            KEY_LENGTH +
            NUM_WANT_LENGTH +
            PORT_LENGTH
    );

    let next = buffer.writeBigUInt64BE(connectionID);

    next = buffer.writeUInt32BE(ACTION_ANNOUNCE, next);

    next = buffer.writeUInt32BE(transactionID, next);

    next += infoHash.copy(buffer, next);

    next += peerID.copy(buffer, next);

    next = buffer.writeBigUInt64BE(downloaded, next);

    next = buffer.writeBigUInt64BE(left, next);

    next = buffer.writeBigUInt64BE(uploaded, next);

    next = buffer.writeUInt32BE(event, next);

    next = buffer.writeUInt32BE(0, next);

    next = buffer.writeUInt32BE(key, next);

    next = buffer.writeUInt32BE(numWant, next);

    buffer.writeUInt16BE(port, next);

    return buffer;
}

export function encodeScrape(connectionID, transactionID, infoHashes) {
    const buffer = Buffer.alloc(
        CONNECTION_ID_LENGTH +
            ACTION_LENGTH +
            TRANSACTION_ID_LENGTH +
            infoHashes.length * INFO_HASH_LENGTH
    );

    let next = buffer.writeBigUInt64BE(connectionID);

    next = buffer.writeUInt32BE(ACTION_SCRAPE, next);

    next = buffer.writeUInt32BE(transactionID, next);

    for (const infoHash of infoHashes) {
        next += infoHash.copy(buffer, next);
    }

    return buffer;
}

export function decodeConnect(buffer) {
    const action = buffer.readUInt32BE();

    const transactionID = buffer.readUInt32BE(ACTION_LENGTH);

    const connectionID = buffer.readBigUInt64BE(
        ACTION_LENGTH + TRANSACTION_ID_LENGTH
    );

    return { action, transactionID, connectionID };
}

export function decodeAnnounce(buffer) {
    const action = buffer.readUInt32BE();

    const transactionID = buffer.readUInt32BE(ACTION_LENGTH);

    const interval = buffer.readUInt32BE(ACTION_LENGTH + TRANSACTION_ID_LENGTH);

    const leechers = buffer.readUInt32BE(
        ACTION_LENGTH + TRANSACTION_ID_LENGTH + INTERVAL_LENGTH
    );

    const seeders = buffer.readUInt32BE(
        ACTION_LENGTH +
            TRANSACTION_ID_LENGTH +
            INTERVAL_LENGTH +
            LEECHERS_LENGTH
    );

    const peers = buffer.subarray(
        ACTION_LENGTH +
            TRANSACTION_ID_LENGTH +
            INTERVAL_LENGTH +
            LEECHERS_LENGTH +
            SEEDERS_LENGTH
    );

    return { action, transactionID, interval, leechers, seeders, peers };
}

export function decodeScrape(buffer) {
    const action = buffer.readUInt32BE();

    const transactionID = buffer.readUInt32BE(ACTION_LENGTH);

    const stats = buffer.subarray(ACTION_LENGTH + TRANSACTION_ID_LENGTH);

    return { action, transactionID, stats };
}

export function decodeError(buffer) {
    const action = buffer.readUInt32BE();

    const transactionID = buffer.readUInt32BE(ACTION_LENGTH);

    const errorMessage = buffer
        .subarray(ACTION_LENGTH + TRANSACTION_ID_LENGTH)
        .toString();

    return { action, transactionID, errorMessage };
}
