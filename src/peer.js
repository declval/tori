import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { createConnection } from "node:net";
import { finished } from "node:stream";
import { options } from "./main.js";
import * as message from "./message.js";

const MAX_IN_FLIGHT = 8;

export class Peer {
    constructor(peerIndex, download) {
        this.download = download;

        this.availablePieces = new Set();
        this.buffer = Buffer.alloc(this.download.metadata.pieceLength);
        this.choking = true;
        this.currentPieceIndex = null;
        this.expected = new Set();
        this.handshakeReceived = false;
        this.inFlight = 0;
        this.interested = false;
        this.port = null;
        this.reservedBits = new Set();
        this.savedChunk = null;
        this.start = 0;

        const { ip, port } =
            this.download.tracker.peers[
                randomInt(this.download.tracker.peers.length)
            ];

        this.socket = createConnection(port, ip)
            .setTimeout(8000)
            .on("connect", () => {
                this.socket.write(
                    message.encodeHandshake(
                        this.download.metadata.infoHash,
                        options.peerID
                    )
                );

                if (options.verbose) {
                    console.log("Sent handshake");
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
                if (options.verbose) {
                    console.log("Socket timed out");
                }

                this.socket.destroy();
            });

        finished(this.socket, (error) => {
            if (error && options.verbose) {
                console.error(error.message);
            }

            if (this.currentPieceIndex !== null) {
                this.download.piecesToDownload.unshift(this.currentPieceIndex);

                this.currentPieceIndex = null;
            }

            if (this.download.piecesToDownload.length) {
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
                !infoHash.equals(this.download.metadata.infoHash)
            ) {
                if (options.verbose) {
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

            if (options.verbose) {
                console.log("Received handshake");
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
            if (options.verbose) {
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
            if (options.verbose) {
                console.log("Received choke");
            }

            this.choking = true;
        } else if (messageID === message.ID_UNCHOKE) {
            if (options.verbose) {
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
            if (options.verbose) {
                console.log("Received interested");
            }

            this.interested = true;
        } else if (messageID === message.ID_NOT_INTERESTED) {
            if (options.verbose) {
                console.log("Received not interested");
            }

            this.interested = false;
        } else if (messageID === message.ID_HAVE) {
            const pieceIndex = message.decodeHave(chunk);

            if (options.verbose) {
                console.log(`Received have ${pieceIndex}`);
            }

            this.availablePieces.add(pieceIndex);
        } else if (messageID === message.ID_BITFIELD) {
            const bitfield = message.decodeBitfield(chunk);

            if (options.verbose) {
                console.log("Received bitfield");
            }

            this.availablePieces = this.availablePieces.union(
                parseBitfield(bitfield, this.download.metadata.hashes.length)
            );
        } else if (messageID === message.ID_REQUEST) {
            const { pieceIndex, begin, length } = message.decodeRequest(chunk);

            if (options.verbose) {
                console.log(
                    `Received request [${pieceIndex}, ${begin}, ${length}]`
                );
            }
        } else if (messageID === message.ID_PIECE) {
            const { pieceIndex, begin, block } = message.decodePiece(chunk);

            if (options.verbose) {
                console.log(
                    `Received piece [${pieceIndex}, ${begin}, ${block.toString("hex").slice(0, 16)}...]`
                );
            }

            if (pieceIndex !== this.currentPieceIndex) {
                if (options.verbose) {
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
                    if (options.verbose) {
                        console.log(`Hash of piece ${pieceIndex} matched`);
                    }

                    this.currentPieceIndex = null;

                    this.download.writePiece(pieceIndex, piece);

                    this.download.downloaded +=
                        this.download.pieceLength(pieceIndex);
                } else {
                    if (options.verbose) {
                        console.error(
                            `Hash of piece ${pieceIndex} did not match`
                        );
                    }
                }

                this.inFlight = 0;
                this.start = 0;
            }

            if (this.download.downloaded === this.download.metadata.length) {
                this.socket.destroy();

                return;
            }
        } else if (messageID === message.ID_CANCEL) {
            const { pieceIndex, begin, length } = message.decodeCancel(chunk);

            if (options.verbose) {
                console.log(
                    `Received cancel [${pieceIndex}, ${begin}, ${length}]`
                );
            }
        } else if (messageID === message.ID_PORT) {
            const port = message.decodePort(chunk);

            if (options.verbose) {
                console.log(`Received port ${port}`);
            }

            this.port = port;
        } else {
            if (options.verbose) {
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
        if (this.currentPieceIndex === null) {
            if (!this.download.piecesToDownload.length) {
                this.socket.destroy();

                return;
            }

            this.buffer.fill(0);
            this.currentPieceIndex = this.download.piecesToDownload.shift();
        }

        if (!this.availablePieces.has(this.currentPieceIndex)) {
            this.socket.destroy();

            return;
        }

        const blocks = this.download.blocks(this.currentPieceIndex);

        if (this.expected.size === 0) {
            this.expected = this.expected.union(
                new Set(blocks.map((block) => block.join()))
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

            if (options.verbose) {
                console.log(
                    `Sent request [${pieceIndex}, ${begin}, ${length}]`
                );
            }
        }
    }
}

function parseBitfield(bitfield, piecesLength) {
    const availablePieces = new Set();
    const leftoverBitLength = bitfield.length * 8 - piecesLength;
    const leftoverBits =
        bitfield[bitfield.length - 1] & ((1 << leftoverBitLength) - 1);

    if (leftoverBits > 0) {
        throw new Error(
            `Bitfield has non-zero leftover bits ${leftoverBits.toString(2)}`
        );
    }

    for (let i = 0; i < bitfield.length; ++i) {
        for (let j = 0; j < 8; ++j) {
            if ((bitfield[i] >> (7 - j)) & 1) {
                availablePieces.add(i * 8 + j);
            }
        }
    }

    return availablePieces;
}
