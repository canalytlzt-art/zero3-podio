import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = await mkdtemp(join(tmpdir(), "zero3-auth-guard-"));
try {
  const output = join(dir, "test.mjs");
  const fixture = resolve("src/lib/test-support/auth-dependencies.ts");
  await build({
    entryPoints: ["src/lib/zero3-auth-guard.test.ts"],
    outfile: output, bundle: true, platform: "node", format: "esm",
    alias: { "@clerk/express": fixture, "@workspace/db": fixture },
  });
  const run = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  process.exitCode = run.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
