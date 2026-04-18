#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith("--") || value === undefined) {
      throw new Error(`invalid arguments near: ${key ?? "<end>"}`);
    }

    values.set(key.slice(2), value);
    index += 1;
  }

  return {
    inputDir: values.get("input-dir"),
    output: values.get("output"),
    version: values.get("version"),
    pubDate: values.get("pub-date"),
    notesFile: values.get("notes-file")
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.inputDir || !options.output || !options.version || !options.notesFile) {
    throw new Error("missing required arguments");
  }

  const entries = await readdir(options.inputDir, { withFileTypes: true });
  const fragmentFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(options.inputDir, entry.name))
    .sort();

  if (fragmentFiles.length === 0) {
    throw new Error(`no updater fragments found in ${options.inputDir}`);
  }

  const platforms = {};

  for (const fragmentFile of fragmentFiles) {
    const fragment = JSON.parse(await readFile(fragmentFile, "utf8"));

    if (!fragment.platform || !fragment.url || !fragment.signature) {
      throw new Error(`invalid fragment file: ${fragmentFile}`);
    }

    platforms[fragment.platform] = {
      url: fragment.url,
      signature: fragment.signature
    };
  }

  const notes = await readFile(options.notesFile, "utf8");
  const manifest = {
    version: options.version,
    notes: notes.trim(),
    ...(options.pubDate ? { pub_date: options.pubDate } : {}),
    platforms
  };

  await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
