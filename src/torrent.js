import { decode, encode } from "./bencode.js";
import { sha1sum } from "./util.js";

export class Torrent {
    #infoHash;

    constructor(buffer) {
        const decoded = decode(buffer);

        if (decoded.announce !== undefined) {
            this.announce = decoded.announce.toString();
        }

        if (decoded["announce-list"] !== undefined) {
            this.announceList = decoded["announce-list"].map((tier) =>
                tier.map((announce) => announce.toString())
            );
        }

        if (decoded.comment !== undefined) {
            this.comment = decoded.comment.toString();
        }

        if (decoded["created by"] !== undefined) {
            this.createdBy = decoded["created by"].toString();
        }

        if (decoded["creation date"] !== undefined) {
            this.creationDate = new Date(decoded["creation date"] * 1000);
        }

        this.info = decoded.info;

        this.#infoHash = sha1sum(encode(this.info));

        if (this.info.files !== undefined) {
            this.info.files = this.info.files.map((file) => {
                file.path = file.path.map((segment) => segment.toString());

                return file;
            });
        }

        this.info.name = this.info.name.toString();

        this.info.pieceLength = this.info["piece length"];

        delete this.info["piece length"];

        const pieces = [];

        for (let i = 0; i < this.info.pieces.length; i += 20) {
            pieces.push(this.info.pieces.subarray(i, i + 20));
        }

        this.info.pieces = pieces;

        if (decoded["url-list"] !== undefined) {
            this.urlList = decoded["url-list"].map((url) => url.toString());
        }
    }

    infoHash() {
        return this.#infoHash;
    }
}
