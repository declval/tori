import { Buffer } from "node:buffer";
import { randomFillSync } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cwd, exit } from "node:process";
import { parseArgs } from "node:util";
import { Download } from "./download.js";
import { Torrent } from "./torrent.js";

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        output: {
            default: cwd(),
            short: "o",
            type: "string",
        },
        verbose: {
            default: false,
            short: "v",
            type: "boolean",
        },
        version: {
            short: "V",
            type: "boolean",
        },
    },
});

export const options = values;

options.peerID = Buffer.alloc(20);

const written = options.peerID.write("-to0030-");

randomFillSync(options.peerID, written);

if (options.version) {
    console.log("tori v0.3.0");

    exit(0);
}

if (!existsSync(options.output)) {
    console.error(`Directory '${options.output}' does not exist`);

    exit(1);
}

if (!statSync(options.output).isDirectory()) {
    console.error(`'${options.output}' is not a directory`);

    exit(1);
}

if (positionals.length !== 1) {
    usage("Torrent file was not given");

    exit(1);
}

const metadata = new Torrent(await readFile(positionals[0]));

const download = new Download(metadata).on(
    "done",
    async (alreadyDownloaded) => {
        if (!options.verbose) {
            console.log();
        }

        if (!alreadyDownloaded) {
            try {
                await download.tracker.completed();
            } catch (error) {
                if (options.verbose) {
                    console.error(`Tracker request failed: ${error.message}`);
                }
            }
        }

        exit(0);
    }
);

await download.start();

function usage(message) {
    console.error(
        `Error: ${message}\n\nUsage: tori [-V|--version] [-o|--output <dir>] [-v|--verbose] <torrent>`
    );
}
