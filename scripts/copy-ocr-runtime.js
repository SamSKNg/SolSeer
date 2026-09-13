import { createRequire } from "node:module";
import { readFile, cp } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";

// Copy only the two named OCR packages and their declared runtime dependencies.
export async function copyOcrRuntime(root, app, additionalPackages = []) {
  const modules = join(root, "node_modules");
  const seen = new Set();
  async function visit(name, from) {
    const require = createRequire(from);
    const manifest = require.resolve(`${name}/package.json`);
    if (seen.has(manifest)) return;
    seen.add(manifest);
    const folder = dirname(manifest);
    const within = relative(modules, folder);
    if (within.startsWith("..") || isAbsolute(within))
      throw new Error("OCR dependency is outside node_modules");
    await cp(folder, join(app, "node_modules", within), { recursive: true });
    const pkg = JSON.parse(await readFile(manifest, "utf8"));
    for (const dependency of Object.keys(pkg.dependencies ?? {}))
      await visit(dependency, manifest);
  }
  for (const name of ["tesseract.js", "@tesseract.js-data/eng", ...additionalPackages])
    await visit(name, join(root, "package.json"));
}
