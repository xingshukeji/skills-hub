#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "course");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function normalizeParagraph(value) {
  return value.replace(/\s+/gu, " ").trim();
}

const files = await walk(root);
const rows = [];
const duplicates = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const relativePath = path.relative(root, file).replaceAll("\\", "/");
  const paragraphs = source.split(/(?:\r?\n){2,}/u).map(normalizeParagraph);
  const prose = paragraphs.filter((paragraph) =>
    paragraph.length >= 80 && !/^(?:#|```|\||<)/u.test(paragraph)
  );
  for (const paragraph of prose) {
    const locations = duplicates.get(paragraph) ?? [];
    locations.push(relativePath);
    duplicates.set(paragraph, locations);
  }
  rows.push({
    path: relativePath,
    chars: source.length,
    headings: (source.match(/^#{2,3} /gmu) ?? []).length,
    links: (source.match(/\]\(/gu) ?? []).length,
    longParagraphs: prose.filter((paragraph) => paragraph.length > 180).length,
    redirectLike: /window\.location\.(?:replace|assign)|正在前往|迁移|兼容/u.test(source)
  });
}

console.log("LOW_DENSITY_CANDIDATES");
for (const row of rows
  .filter((item) => item.chars < 1200 || item.redirectLike)
  .sort((left, right) => left.chars - right.chars)) {
  console.log(JSON.stringify(row));
}

console.log("\nLONG_PARAGRAPH_CANDIDATES");
for (const row of rows
  .filter((item) => item.longParagraphs > 0)
  .sort((left, right) => right.longParagraphs - left.longParagraphs)) {
  console.log(JSON.stringify(row));
}

console.log("\nDUPLICATE_PARAGRAPHS");
for (const [paragraph, locations] of [...duplicates.entries()]
  .filter(([, values]) => new Set(values).size > 1)
  .sort((left, right) => right[1].length - left[1].length)) {
  console.log(JSON.stringify({ preview: paragraph.slice(0, 140), locations: [...new Set(locations)] }));
}
