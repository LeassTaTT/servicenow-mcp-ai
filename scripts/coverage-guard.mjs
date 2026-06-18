// Preflight for `npm run test:coverage` (and therefore `npm run check` /
// `prepublishOnly`).
//
// The coverage tool c8@11 (its latest release) pulls yargs@17, whose
// extensionless CJS entry file lives under a "type":"module" package. Node >= 25
// loads that file as ESM, so it crashes with a cryptic
//   ReferenceError: require is not defined in ES module scope
// before any coverage runs. There is no Node-25-compatible c8 release yet, and
// forcing yargs@18 is not an option — it is ESM-only and the Node 20 CI leg
// cannot require() it. The supported dev/CI runtimes (Node 20–24; .nvmrc pins
// Node 22) are unaffected, so fail fast here with an actionable message instead
// of the cryptic crash.
const major = Number(process.versions.node.split(".")[0]);

if (Number.isFinite(major) && major >= 25) {
  process.stderr.write(
    `\nCoverage (c8) is not supported on Node ${process.versions.node}.\n` +
      `c8's yargs dependency crashes on Node >= 25 and has no compatible release yet.\n\n` +
      `  • Use the pinned runtime:        nvm use      (.nvmrc pins Node 22)\n` +
      `  • Or run a coverage-free gate:   npm run verify\n\n`,
  );
  process.exit(1);
}
