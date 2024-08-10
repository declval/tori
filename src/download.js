import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, open, statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { stdout } from "node:process";
import config from "./config.js";
import { Peer } from "./peer.js";
import { Tracker } from "./tracker.js";
import { sha1sum } from "./util.js";

const BLOCK_LENGTH = 2 ** 14;
const PEER_COUNT = 8;

export class Download extends EventEmitter {
    constructor(node, torrent) {
        super();

        this.node = node;
        this.torrent = torrent;

        this.available = new Array(this.torrent.info.pieces.length).fill(0);
        this.downloaded = 0;
        this.files =
            this.torrent.info.files !== undefined
                ? this.torrent.info.files
                : [
                      {
                          length: this.torrent.info.length,
                          path: [this.torrent.info.name],
                      },
                  ];
        this.intervalTimeout = null;
        this.length =
            this.torrent.info.length !== undefined
                ? this.torrent.info.length
                : this.torrent.info.files.reduce(
                      (sum, { length }) => sum + length,
                      0
                  );
        this.output =
            this.torrent.info.length !== undefined
                ? config.outputDirectory
                : join(config.outputDirectory, this.torrent.info.name);
        this.peers = new Array(PEER_COUNT);
        this.piecesDownloaded = [];
        this.piecesToDownload = new Set();
        this.prevDownloaded = 0;
        this.prevTime = null;
        this.prevUploaded = 0;
        this.server = createServer()
            .listen(config.peerPort)
            .on("close", () => {
                if (config.verbose) {
                    console.log("Server closed");
                }
            })
            .on("connection", (socket) => {
                if (config.verbose) {
                    console.log("Server connected ${socket}");
                }
            })
            .on("error", (error) => {
                if (config.verbose) {
                    console.error(error.message);
                }

                if (error.code == "EADDRINUSE") {
                    if (config.verbose) {
                        console.error("Retrying in 1 second...");
                    }

                    setTimeout(() => {
                        this.server.close();
                        this.server.listen(config.peerPort);
                    }, 1000);
                }
            });
        this.statusTimeout = null;
        this.tracker = new Tracker(this);
        this.uploaded = 0;
    }

    async checkDownloadedPieces() {
        for (
            let pieceIndex = 0;
            pieceIndex < this.torrent.info.pieces.length;
            ++pieceIndex
        ) {
            let piece;

            try {
                piece = await this.readPiece(pieceIndex);
            } catch {
                this.piecesToDownload.add(pieceIndex);

                continue;
            }

            if (this.checkPieceHash(piece, pieceIndex)) {
                this.downloaded += this.pieceLength(pieceIndex);

                this.piecesDownloaded.push(pieceIndex);
            } else {
                this.piecesToDownload.add(pieceIndex);
            }
        }

        this.prevDownloaded = this.downloaded;
    }

    async enoughSpace() {
        const required = this.leftToDownload();

        const { bavail, bsize } = await statfs(config.outputDirectory);
        const available = bavail * bsize;

        if (required > available) {
            return false;
        }

        return true;
    }

    async readPiece(pieceIndex) {
        const buffer = Buffer.alloc(this.torrent.info.pieceLength);

        let fileHandle;
        let offset = 0;

        for (const { path, length, position } of this.#pieceToFileLocations(
            pieceIndex
        )) {
            try {
                fileHandle = await open(path, "r");

                await fileHandle.read(buffer, offset, length, position);
            } finally {
                await fileHandle?.close();
            }

            offset += length;
        }

        return buffer;
    }

    async start() {
        // try {
        //     for (const { address, port } of config.bootstrapNodes) {
        //         const result = await this.node.getPeers(
        //             port,
        //             address,
        //             this.torrent.infoHash()
        //         );

        //         if (result !== undefined && result.peers) {
        //             for (const peer of result.peers) {
        //                 if (!this.tracker.peerIPs.has(peer.ip)) {
        //                     // console.log("Adding new peer from DHT");

        //                     this.tracker.peerIPs.add(peer.ip);
        //                     this.tracker.peers.push(peer);
        //                 }
        //             }
        //         }
        //     }
        // } catch (error) {
        //     if (config.verbose) {
        //         console.error(error);
        //     }

        //     exit(1);
        // }

        await this.checkDownloadedPieces();

        if (this.piecesToDownload.size === 0) {
            this.emit("done", true);

            return;
        }

        if (!(await this.enoughSpace())) {
            console.error("Not enough space available");

            return;
        }

        try {
            await this.tracker.started();
        } catch (error) {
            console.error(`Tracker request failed: ${error.message}`);

            return;
        }

        if (!config.verbose) {
            this.statusTimeout = setInterval(() => {
                this.#printStatus();
            }, 2000);
        }

        for (let i = 0; i < this.peers.length; ++i) {
            this.peers[i] = new Peer(i, this);
        }
    }

    async stop() {
        for (let i = 0; i < this.peers.length; ++i) {
            this.peers[i].socket.destroy();
        }

        if (!config.verbose) {
            clearInterval(this.statusTimeout);
        }

        try {
            await this.tracker.stopped();
        } catch (error) {
            if (config.verbose) {
                console.error(`Tracker request failed: ${error.message}`);
            }
        }
    }

    async writePiece(pieceIndex, piece) {
        let fileHandle;
        let offset = 0;

        for (const { path, length, position } of this.#pieceToFileLocations(
            pieceIndex
        )) {
            if (!existsSync(path)) {
                await mkdir(dirname(path), { recursive: true });

                const fileHandle = await open(path, "w");

                await fileHandle.close();
            }

            try {
                fileHandle = await open(path, "r+");

                await fileHandle.write(piece, offset, length, position);
            } finally {
                await fileHandle?.close();
            }

            offset += length;
        }
    }

    blocks(pieceIndex) {
        const blocks = [];
        const pieceLength = this.pieceLength(pieceIndex);

        for (let i = 0; i < pieceLength; i += BLOCK_LENGTH) {
            blocks.push([
                pieceIndex,
                i,
                Math.min(BLOCK_LENGTH, pieceLength - i),
            ]);
        }

        return blocks;
    }

    checkPieceHash(piece, pieceIndex) {
        return sha1sum(piece).equals(this.torrent.info.pieces[pieceIndex]);
    }

    leftToDownload() {
        return this.length - this.downloaded;
    }

    pieceLength(pieceIndex) {
        if (pieceIndex === this.torrent.info.pieces.length - 1) {
            return (
                this.torrent.info.pieceLength -
                (this.torrent.info.pieces.length *
                    this.torrent.info.pieceLength -
                    this.length)
            );
        }

        return this.torrent.info.pieceLength;
    }

    #pieceToFileLocations(pieceIndex) {
        const pieceOffset = pieceIndex * this.torrent.info.pieceLength;
        const result = [];

        let fileOffset = 0;
        let i;
        let pieceLength = this.pieceLength(pieceIndex);

        for (i = 0; i < this.files.length; ++i) {
            if (
                pieceOffset >= fileOffset &&
                pieceOffset < fileOffset + this.files[i].length
            ) {
                const remainingLength =
                    this.files[i].length - (pieceOffset - fileOffset);

                result.push({
                    path: join(this.output, ...this.files[i].path),
                    length: Math.min(remainingLength, pieceLength),
                    position: pieceOffset - fileOffset,
                });

                pieceLength -= Math.min(remainingLength, pieceLength);

                break;
            }

            fileOffset += this.files[i].length;
        }

        for (++i; pieceLength > 0; ++i) {
            const length = Math.min(this.files[i].length, pieceLength);

            result.push({
                path: join(this.output, ...this.files[i].path),
                length: length,
                position: 0,
            });

            pieceLength -= length;
        }

        return result;
    }

    #printStatus() {
        const columns = Math.min(stdout.columns, 80);
        const speed = this.#speed();
        const downloadSpeed = `↓ ${formatSpeed(speed.downloadSpeed)} `;
        const downloaded = `${((this.downloaded * 100) / this.length).toFixed(1)}%`;
        const name =
            this.torrent.info.name.length > 64
                ? `${this.torrent.info.name.slice(0, 64 - "...".length)}...`
                : this.torrent.info.name;
        const uploadSpeed = `↑ ${formatSpeed(speed.uploadSpeed)} `;
        const spaceCount =
            columns -
            name.length -
            downloadSpeed.length -
            uploadSpeed.length -
            downloaded.length;
        const spaces = spaceCount > 0 ? " ".repeat(spaceCount) : " ";

        stdout.clearLine(0, () =>
            stdout.cursorTo(0, () =>
                stdout.write(
                    `${name}${spaces}${downloadSpeed}${uploadSpeed}${downloaded}`
                )
            )
        );
    }

    #speed() {
        if (this.prevTime === null) {
            this.prevTime = new Date();
            return { downloadSpeed: 0, uploadSpeed: 0 };
        }

        const timeDiff = (new Date() - this.prevTime) / 1000;
        const downloadSpeed =
            (this.downloaded - this.prevDownloaded) / timeDiff;
        const uploadSpeed = (this.uploaded - this.prevUploaded) / timeDiff;

        this.prevDownloaded = this.downloaded;
        this.prevUploaded = this.uploaded;
        this.prevTime = new Date();

        return { downloadSpeed, uploadSpeed };
    }
}

function formatSpeed(speed) {
    const units = ["b", "KiB", "MiB", "GiB"];

    let i = 0;

    while (speed >= 1024 && i + 1 < units.length) {
        ++i;
        speed /= 1024;
    }

    return `${speed.toFixed(1)}${units[i]}/s`;
}
