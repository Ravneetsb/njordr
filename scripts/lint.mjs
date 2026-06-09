import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(projectRoot);

const eslint = new ESLint({
  cwd: projectRoot,
  overrideConfigFile: path.join(projectRoot, "eslint.config.mjs"),
});

const results = await eslint.lintFiles(["src/**/*.{ts,tsx}", "*.{ts,mjs}"]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) console.log(output);

const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);
if (errorCount > 0 || warningCount > 0) {
  process.exitCode = errorCount > 0 ? 1 : 0;
}
