import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { open, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
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
        this.intervalTimeout = null;
        this.output = join(options.output, this.metadata.name);
        this.peers = new Array(PEER_COUNT);
        this.piecesToDownload = this.metadata.hashes.map(
            (_hash, pieceIndex) => pieceIndex
        );
        this.prevDownloaded = 0;
        this.prevTime = null;
        this.statusTimeout = null;
        this.tracker = new Tracker(
            this.metadata.announce,
            this.metadata.infoHash
        );
        this.uploaded = 0;
    }

    async checkDownloadedPieces() {
        const downloadedPieces = new Set();
        const stats = await stat(this.output);

        for (
            let i = 0, pieceIndex = 0;
            i < stats.size && pieceIndex < this.metadata.hashes.length;
            i += this.metadata.pieceLength, ++pieceIndex
        ) {
            let piece;

            try {
                piece = await this.readPiece(pieceIndex);
            } catch {
                break;
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

        try {
            fileHandle = await open(this.output, "r");

            await fileHandle.read(
                buffer,
                0,
                this.pieceLength(pieceIndex),
                pieceIndex * this.metadata.pieceLength
            );
        } finally {
            await fileHandle?.close();
        }

        return buffer;
    }

    async start() {
        if (!existsSync(this.output)) {
            const fileHandle = await open(this.output, "w");

            await fileHandle.close();
        }

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
            await this.tracker.started(
                this.downloaded,
                this.leftToDownload(),
                this.uploaded
            );
        } catch (error) {
            console.error(`Tracker request failed: ${error.message}`);

            return;
        }

        this.intervalTimeout = setInterval(async () => {
            try {
                await this.tracker.request(
                    this.downloaded,
                    this.leftToDownload(),
                    this.uploaded
                );
            } catch (error) {
                console.error(`Tracker request failed: ${error.message}`);
            }
        }, this.tracker.interval * 1000);

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

        clearInterval(this.intervalTimeout);

        try {
            await this.tracker.stopped(
                this.downloaded,
                this.leftToDownload(),
                this.uploaded
            );
        } catch (error) {
            console.error(`Tracker request failed: ${error.message}`);
        }
    }

    async writePiece(pieceIndex, piece) {
        let fileHandle;

        try {
            fileHandle = await open(this.output, "r+");

            await fileHandle.write(
                piece,
                0,
                this.pieceLength(pieceIndex),
                pieceIndex * this.metadata.pieceLength
            );
        } finally {
            await fileHandle?.close();
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
        return this.metadata.length - this.downloaded;
    }

    pieceLength(pieceIndex) {
        if (pieceIndex === this.metadata.hashes.length - 1) {
            return (
                this.metadata.pieceLength -
                (this.metadata.hashes.length * this.metadata.pieceLength -
                    this.metadata.length)
            );
        }

        return this.metadata.pieceLength;
    }

    writeStatus() {
        const columns = Math.min(stdout.columns, MAX_COLUMNS);
        const downSpeed = `↓ ${formatSpeed(this.#downSpeed())} `;
        const downloaded = `${((this.downloaded * 100) / this.metadata.length).toFixed(1)}%`;
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
