import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createConnection } from "node:net";
import { finished } from "node:stream";
import config from "./config.js";
import * as message from "./message.js";

const MAX_IN_FLIGHT = 8;
const TIMEOUT = 20_000;

export class Peer {
    constructor(peerIndex, download) {
        this.download = download;

        this.available = null;
        this.buffer = Buffer.alloc(this.download.torrent.info.pieceLength);
        this.choking = true;
        this.currentPieceIndex = null;
        this.expected = new Set();
        this.handshakeReceived = false;
        this.inFlight = 0;
        this.interested = false;
        this.ip = null;
        this.port = null;
        this.reservedBits = new Set();
        this.savedChunk = null;
        this.start = 0;

        if (this.download.tracker.peers.length === 0) {
            console.error("No more peers available");

            process.exit(1);
        }

        const peer =
            this.download.tracker.peers[
                randomInt(this.download.tracker.peers.length)
            ];

        this.ip = peer.ip;

        this.socket = createConnection(peer.port, peer.ip)
            .setTimeout(TIMEOUT)
            .on("connect", () => {
                this.socket.write(
                    message.encodeHandshake(
                        this.download.torrent.infoHash(),
                        config.peerID
                    )
                );

                if (config.verbose) {
                    console.log("Sent handshake");
                }

                this.socket.write(
                    message.encodeBitfield(
                        encodeBitfield(
                            this.download.piecesDownloaded,
                            this.download.torrent.info.pieces.length
                        )
                    )
                );

                if (config.verbose) {
                    console.log("Sent bitfield");
                }
            })
            .on("data", async (chunk) => {
                if (this.savedChunk !== null) {
                    chunk = Buffer.concat([this.savedChunk, chunk]);
                    this.savedChunk = null;
                }

                await this.parse(chunk);
            })
            .on("timeout", () => {
                if (config.verbose) {
                    console.log("Socket timed out");
                }

                this.socket.destroy();
            });

        finished(this.socket, (error) => {
            if (error && config.verbose) {
                console.error(error.message);
            }

            if (this.currentPieceIndex !== null) {
                this.download.piecesToDownload.add(this.currentPieceIndex);

                this.currentPieceIndex = null;
            }

            if (this.download.piecesToDownload.size) {
                if (this.available !== null) {
                    for (
                        let pieceIndex = 0;
                        pieceIndex < this.download.available.length;
                        ++pieceIndex
                    ) {
                        this.download.available[pieceIndex] -=
                            this.available[pieceIndex];
                    }
                }

                this.download.peers[peerIndex] = new Peer(
                    peerIndex,
                    this.download
                );
            } else {
                this.download.peers[peerIndex] = null;

                if (this.download.peers.every((peer) => peer === null)) {
                    this.download.emit("done", false);
                }
            }
        });
    }

    async parse(chunk) {
        if (chunk.length === 0) {
            return;
        }

        if (!this.handshakeReceived) {
            if (chunk.length < 68) {
                this.savedChunk = Buffer.from(chunk);

                return;
            }

            this.handshakeReceived = true;

            const { protocolLength, protocol, reserved, infoHash } =
                message.decodeHandshake(chunk);

            if (
                protocolLength !== message.PROTOCOL.length ||
                protocol !== message.PROTOCOL ||
                !infoHash.equals(this.download.torrent.infoHash())
            ) {
                if (config.verbose) {
                    console.error("Invalid handshake");
                }

                this.socket.destroy();

                return;
            }

            const bitString = Array.from(reserved)
                .map((value) => value.toString(2).padStart(8, "0"))
                .join("");

            for (let i = 0; i < bitString.length; ++i) {
                if (bitString[bitString.length - i - 1] === "1") {
                    this.reservedBits.add(i);
                }
            }

            if (config.verbose) {
                console.log("Received handshake");
            }

            // Peer supports DHT
            if (this.reservedBits.has(0)) {
                this.socket.write(message.encodePort(config.nodePort));
            }

            await this.parse(chunk.subarray(68));

            return;
        }

        if (chunk.length < 4) {
            this.savedChunk = Buffer.from(chunk);

            return;
        }

        const messageLength = chunk.readUInt32BE();

        if (messageLength === 0) {
            if (config.verbose) {
                console.log("Received keep alive");
            }

            await this.parse(chunk.subarray(message.INTEGER_LENGTH));

            return;
        }

        if (chunk.length < message.INTEGER_LENGTH + messageLength) {
            this.savedChunk = Buffer.from(chunk);

            return;
        }

        const messageID = chunk.readUInt8(message.INTEGER_LENGTH);

        if (messageID === message.ID_CHOKE) {
            if (config.verbose) {
                console.log("Received choke");
            }

            this.choking = true;
        } else if (messageID === message.ID_UNCHOKE) {
            if (config.verbose) {
                console.log("Received unchoke");
            }

            this.choking = false;

            const timeout = setInterval(() => {
                if (!this.socket.writable || this.choking) {
                    clearInterval(timeout);
                    return;
                }

                this.#request();
            }, 512);
        } else if (messageID === message.ID_INTERESTED) {
            if (config.verbose) {
                console.log("Received interested");
            }

            this.interested = true;

            this.socket.write(message.encodeUnchoke());

            if (config.verbose) {
                console.log("Sent unchoke");
            }
        } else if (messageID === message.ID_NOT_INTERESTED) {
            if (config.verbose) {
                console.log("Received not interested");
            }

            if (this.interested) {
                this.interested = false;

                this.socket.write(message.encodeChoke());

                if (config.verbose) {
                    console.log("Sent choke");
                }
            }
        } else if (messageID === message.ID_HAVE) {
            const pieceIndex = message.decodeHave(chunk);

            if (config.verbose) {
                console.log(`Received have ${pieceIndex}`);
            }

            this.available[pieceIndex] = 1;
            ++this.download.available[pieceIndex];
        } else if (messageID === message.ID_BITFIELD) {
            const bitfield = message.decodeBitfield(chunk);

            if (config.verbose) {
                console.log("Received bitfield");
            }

            this.available = decodeBitfield(
                bitfield,
                this.download.torrent.info.pieces.length
            );

            for (
                let pieceIndex = 0;
                pieceIndex < this.download.available.length;
                ++pieceIndex
            ) {
                this.download.available[pieceIndex] +=
                    this.available[pieceIndex];
            }
        } else if (messageID === message.ID_REQUEST) {
            const { pieceIndex, begin, length } = message.decodeRequest(chunk);

            if (config.verbose) {
                console.log(
                    `Received request [${pieceIndex}, ${begin}, ${length}]`
                );
            }

            const piece = await this.download.readPiece(pieceIndex);

            const block = piece.subarray(begin, begin + length);

            this.socket.write(message.encodePiece(pieceIndex, begin, block));

            this.download.uploaded += length;

            if (config.verbose) {
                console.log("Sent piece");
            }
        } else if (messageID === message.ID_PIECE) {
            const { pieceIndex, begin, block } = message.decodePiece(chunk);

            if (config.verbose) {
                console.log(
                    `Received piece [${pieceIndex}, ${begin}, ${block.toString("hex").slice(0, 16)}...]`
                );
            }

            if (pieceIndex !== this.currentPieceIndex) {
                if (config.verbose) {
                    console.error("Received unexpected piece");

                    this.socket.destroy();

                    return;
                }
            }

            --this.inFlight;

            this.expected.delete([pieceIndex, begin, block.length].join());

            block.copy(this.buffer, begin);

            if (this.expected.size === 0) {
                const piece = Buffer.from(this.buffer);

                if (this.download.checkPieceHash(piece, pieceIndex)) {
                    if (config.verbose) {
                        console.log(`Hash of piece ${pieceIndex} matched`);
                    }

                    this.currentPieceIndex = null;

                    this.download.writePiece(pieceIndex, piece);

                    this.download.downloaded +=
                        this.download.pieceLength(pieceIndex);
                } else {
                    if (config.verbose) {
                        console.error(
                            `Hash of piece ${pieceIndex} did not match`
                        );
                    }
                }

                this.inFlight = 0;
                this.start = 0;
            }

            if (this.download.downloaded === this.download.length) {
                this.socket.destroy();

                return;
            }
        } else if (messageID === message.ID_CANCEL) {
            const { pieceIndex, begin, length } = message.decodeCancel(chunk);

            if (config.verbose) {
                console.log(
                    `Received cancel [${pieceIndex}, ${begin}, ${length}]`
                );
            }
        } else if (messageID === message.ID_PORT) {
            const port = message.decodePort(chunk);

            if (config.verbose) {
                console.log(`Received port ${port}`);
            }

            this.port = port;

            // try {
            //     this.download.node
            //         .getPeers(port, this.ip, this.download.torrent.infoHash())
            //         .then((result) => {
            //             if (result !== undefined && result.peers) {
            //                 for (const peer of result.peers) {
            //                     if (
            //                         !this.download.tracker.peerIPs.has(peer.ip)
            //                     ) {
            //                         console.log("Adding new peer from DHT");

            //                         this.download.tracker.peerIPs.add(peer.ip);
            //                         this.download.tracker.peers.push(peer);
            //                     }
            //                 }
            //             }
            //         });
            // } catch (error) {
            //     console.error(error.message);
            // }
        } else {
            if (config.verbose) {
                console.error(`Unexpected message ${messageID}`);
            }

            this.socket.destroy();

            return;
        }

        await this.parse(
            chunk.subarray(message.INTEGER_LENGTH + messageLength)
        );
    }

    #request() {
        if (this.available === null) {
            this.socket.destroy();

            return;
        }

        if (this.currentPieceIndex === null) {
            if (!this.download.piecesToDownload.size) {
                this.socket.destroy();

                return;
            }

            this.buffer.fill(0);

            for (
                let pieceIndex = 0;
                pieceIndex < this.available.length;
                ++pieceIndex
            ) {
                if (
                    this.available[pieceIndex] === 1 &&
                    this.download.piecesToDownload.has(pieceIndex)
                ) {
                    this.currentPieceIndex = pieceIndex;
                    this.download.piecesToDownload.delete(pieceIndex);

                    break;
                }
            }
        }

        if (this.currentPieceIndex === null) {
            this.socket.destroy();

            return;
        }

        const blocks = this.download.blocks(this.currentPieceIndex);

        if (this.expected.size === 0) {
            this.expected = union(
                new Set(blocks.map((block) => block.join())),
                this.expected
            );
        }

        const n = Math.max(MAX_IN_FLIGHT - this.inFlight, 0);

        for (const [pieceIndex, begin, length] of blocks.slice(
            this.start,
            this.start + n
        )) {
            this.socket.write(message.encodeRequest(pieceIndex, begin, length));

            ++this.inFlight;
            ++this.start;

            if (config.verbose) {
                console.log(
                    `Sent request [${pieceIndex}, ${begin}, ${length}]`
                );
            }
        }
    }
}

function decodeBitfield(bitfield, totalPieceCount) {
    const leftoverBitCount = bitfield.length * 8 - totalPieceCount;
    const leftoverBits =
        bitfield[bitfield.length - 1] & ((1 << leftoverBitCount) - 1);
    const available = new Array(totalPieceCount).fill(0);

    if (leftoverBits > 0) {
        throw new Error(
            `Bitfield has non-zero leftover bits ${leftoverBits.toString(2)}`
        );
    }

    for (let i = 0; i < bitfield.length; ++i) {
        for (let j = 0; j < 8; ++j) {
            if ((bitfield[i] >> (7 - j)) & 1) {
                available[i * 8 + j] = 1;
            }
        }
    }

    return available;
}

function encodeBitfield(pieceIndexes, totalPieceCount) {
    const buffer = Buffer.alloc(Math.ceil(totalPieceCount / 8));

    for (const pieceIndex of pieceIndexes) {
        buffer[Math.floor(pieceIndex / 8)] |= 1 << (7 - (pieceIndex % 8));
    }

    return buffer;
}

function union(a, b) {
    const result = new Set(a);

    for (const value of b) {
        result.add(value);
    }

    return result;
}
