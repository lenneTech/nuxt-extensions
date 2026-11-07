/**
 * The packed file paths from an `npm pack --dry-run --json` report, for every npm major the stack runs.
 *
 * npm 11 prints an array with one entry per package. npm 12 prints an object keyed by package name
 * (npm 12.0.0: "the --json output of `npm pack` and `npm publish` have changed"). `check:manifest`
 * read `JSON.parse(raw)[0]`, which is `undefined` for npm 12's object, so it stopped with a
 * TypeError on every machine with npm 12, and in publish.yml as soon as the npm upgrade for Trusted
 * Publishing ran before it. Both shapes carry the same entry: `{ name, files: [{ path }] }`.
 */

/**
 * @param {string} raw stdout of `npm pack --dry-run --json`
 * @param {string} name the package name to read
 * @returns {string[]} the packed file paths
 */
export function packedFilePaths(raw, name) {
  const report = JSON.parse(raw);
  const entries = Array.isArray(report) ? report : Object.values(report ?? {});
  const entry = entries.find((candidate) => candidate?.name === name);
  if (!Array.isArray(entry?.files)) {
    throw new Error(`the npm pack report has no file list for ${name}`);
  }
  return entry.files.map((file) => file.path);
}
