#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exit } from "node:process";
import { parseArgs } from "node:util";
import config from "./config.js";
import { Node } from "./dht.js";
import { Download } from "./download.js";
import { Torrent } from "./torrent.js";

let options;
let positionals;

try {
    const result = parseArgs({
        allowPositionals: true,
        options: {
            output: {
                short: "o",
                type: "string",
            },
            verbose: {
                short: "v",
                type: "boolean",
            },
            version: {
                short: "V",
                type: "boolean",
            },
        },
    });

    options = result.values;
    positionals = result.positionals;
} catch (error) {
    usage(error.message);

    exit(1);
}

if (options.output) {
    config.outputDirectory = resolve(options.output);
}

if (options.verbose) {
    config.verbose = options.verbose;
}

if (options.version) {
    console.log(`${config.name} v${config.version}`);

    exit(0);
}

if (!existsSync(config.outputDirectory)) {
    console.error(`Directory '${config.outputDirectory}' does not exist`);

    exit(1);
}

if (!statSync(config.outputDirectory).isDirectory()) {
    console.error(`'${config.outputDirectory}' is not a directory`);

    exit(1);
}

if (positionals.length !== 1) {
    usage("Torrent file was not specified");

    exit(1);
}

let buffer;

try {
    buffer = await readFile(positionals[0]);
} catch (error) {
    if (config.verbose) {
        console.error(`Could not read ${positionals[0]}`);

        exit(1);
    }
}

const torrent = new Torrent(buffer);

const node = new Node();

node.load();

const download = new Download(node, torrent).on(
    "done",
    async (alreadyDownloaded) => {
        if (!config.verbose) {
            console.log();
        }

        if (!alreadyDownloaded) {
            try {
                await download.tracker.completed();
            } catch (error) {
                if (config.verbose) {
                    console.error(`Tracker request failed: ${error.message}`);
                }
            }
        }

        node.save();

        exit(0);
    }
);

await download.start();

function usage(message) {
    console.error(
        `${message}\n\nUsage: ${config.name} [-V|--version] [-o|--output <dir>] [-v|--verbose] <torrent>`
    );
}
