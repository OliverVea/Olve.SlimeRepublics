import { join } from "node:path";
import { implement } from "@olve/pipelines";
import { test } from "../pipeline";

export default implement(test, async ({ source }, ctx) => {
  const cwd = join(await ctx.files.fetch(source.tree), "src/frontend");
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  await ctx.exec(["npm", "run", "lint"], { cwd });
  await ctx.exec(["npm", "test"], { cwd });
  await ctx.exec(["npm", "run", "build"], { cwd });
});
