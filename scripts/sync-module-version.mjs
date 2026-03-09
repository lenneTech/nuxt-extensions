import { readFileSync, writeFileSync } from "fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const file = "src/module.ts";
const content = readFileSync(file, "utf8").replace(
  /export const version = ".*?"/,
  `export const version = "${version}"`,
);
writeFileSync(file, content);
console.log(`[sync-module-version] ${version}`);
