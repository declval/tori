import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, open, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stdout } from "node:process";
import { options } from "./main.js";
import { Peer } from "./peer.js";
import { Tracker } from "./tracker.js";

const BLOCK_LENGTH = 2 ** 14;
const ELLIPSIS = "...";
const MAX_COLUMNS = 80;
const MAX_NAME_LENGTH = 64;
const PEER_COUNT = 30;

export class Download extends EventEmitter {
    constructor(metadata) {
        super();

        this.metadata = metadata;

        this.downloaded = 0;
        this.files =
            this.metadata.files !== undefined
                ? this.metadata.files
                : [
                      {
                          length: this.metadata.length,
                          path: [this.metadata.name],
                      },
                  ];
        this.intervalTimeout = null;
        this.length =
            this.metadata.length !== undefined
                ? this.metadata.length
                : this.metadata.files.reduce(
                      (sum, { length }) => sum + length,
                      0
                  );
        this.output =
            this.metadata.length !== undefined
                ? options.output
                : join(options.output, this.metadata.name);
        this.peers = new Array(PEER_COUNT);
        this.piecesToDownload = this.metadata.hashes.map(
            (_hash, pieceIndex) => pieceIndex
        );
        this.prevDownloaded = 0;
        this.prevTime = null;
        this.statusTimeout = null;
        this.tracker = new Tracker(this);
        this.uploaded = 0;
    }

    async checkDownloadedPieces() {
        const downloadedPieces = new Set();

        for (
            let pieceIndex = 0;
            pieceIndex < this.metadata.hashes.length;
            ++pieceIndex
        ) {
            let piece;

            try {
                piece = await this.readPiece(pieceIndex);
            } catch {
                continue;
            }

            if (this.checkPieceHash(piece, pieceIndex)) {
                this.downloaded += this.pieceLength(pieceIndex);
                this.prevDownloaded = this.downloaded;

                downloadedPieces.add(pieceIndex);
            }
        }

        this.piecesToDownload = this.piecesToDownload.filter(
            (pieceIndex) => !downloadedPieces.has(pieceIndex)
        );
    }

    async enoughSpace() {
        const required = this.leftToDownload();

        const { bavail, bsize } = await statfs(options.output);
        const available = bavail * bsize;

        if (required > available) {
            return false;
        }

        return true;
    }

    async readPiece(pieceIndex) {
        const buffer = Buffer.alloc(this.metadata.pieceLength);

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
        await this.checkDownloadedPieces();

        if (this.piecesToDownload.length === 0) {
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

        // console.log(this.tracker);
        // process.exit(0);
        //
        if (!options.verbose) {
            this.statusTimeout = setInterval(() => {
                this.writeStatus();
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

        if (!options.verbose) {
            clearInterval(this.statusTimeout);
        }

        try {
            await this.tracker.stopped();
        } catch (error) {
            if (options.verbose) {
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
        return createHash("sha1")
            .update(piece)
            .digest()
            .equals(this.metadata.hashes[pieceIndex]);
    }

    leftToDownload() {
        return this.length - this.downloaded;
    }

    pieceLength(pieceIndex) {
        if (pieceIndex === this.metadata.hashes.length - 1) {
            return (
                this.metadata.pieceLength -
                (this.metadata.hashes.length * this.metadata.pieceLength -
                    this.length)
            );
        }

        return this.metadata.pieceLength;
    }

    writeStatus() {
        const columns = Math.min(stdout.columns, MAX_COLUMNS);
        const downSpeed = `↓ ${formatSpeed(this.#downSpeed())} `;
        const downloaded = `${((this.downloaded * 100) / this.length).toFixed(1)}%`;
        const name =
            this.metadata.name.length > MAX_NAME_LENGTH
                ? `${this.metadata.name.slice(0, MAX_NAME_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
                : this.metadata.name;
        const spacesLength =
            columns - name.length - downSpeed.length - downloaded.length;
        const spaces = spacesLength <= 0 ? " " : " ".repeat(spacesLength);

        stdout.clearLine(0, () =>
            stdout.cursorTo(0, () =>
                stdout.write(`${name}${spaces}${downSpeed}${downloaded}`)
            )
        );
    }

    #downSpeed() {
        if (this.prevTime === null) {
            this.prevTime = new Date();
            return 0;
        }

        const timeDiff = (new Date() - this.prevTime) / 1000;
        const speed = (this.downloaded - this.prevDownloaded) / timeDiff;

        this.prevDownloaded = this.downloaded;
        this.prevTime = new Date();

        return speed;
    }

    #pieceToFileLocations(pieceIndex) {
        const pieceOffset = pieceIndex * this.metadata.pieceLength;
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
