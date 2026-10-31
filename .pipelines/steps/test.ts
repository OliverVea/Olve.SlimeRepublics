import { join } from "node:path";
import { implement, step, Source } from "@olivervea/pipelines";

export const test = implement(step({
  name: "test",
  description: "Frontend checks: Biome, the Vitest suite, typecheck and production build.",
  image: "node:24-alpine",
  input: { source: Source },
  timeoutSeconds: 900,
}), async ({ source }, ctx) => {
  const cwd = join(await ctx.files.fetch(source.tree), "src/frontend");
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  await ctx.exec(["npm", "run", "lint"], { cwd });
  await ctx.exec(["npm", "test"], { cwd });
  await ctx.exec(["npm", "run", "build"], { cwd });
});
