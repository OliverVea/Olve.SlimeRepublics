import { join } from "node:path";
import { implement } from "@olivervea/pipelines";
import { betaTest } from "../pipeline";
import { BETA, checkClient, firstMessage } from "./lib/checks";

// Bots join the world for a minute, so this runs against beta only.
export default implement(betaTest, async ({ source, release }, ctx) => {
  await ctx.retry({ attempts: 6, delaySeconds: 5 }, () => firstMessage(ctx, BETA));
  await checkClient(ctx, BETA);
  const cwd = join(await ctx.files.fetch(source.tree), "src/frontend");
  await ctx.exec(["npm", "ci", "--no-audit", "--no-fund"], { cwd });
  await ctx.exec(["npm", "run", "smoke"], {
    cwd,
    env: { SMOKE_URL: `${BETA.replace(/^https/, "wss")}/ws`, SMOKE_BOTS: "3", SMOKE_SECONDS: "60" },
  });
  ctx.log("bots played on beta", { namespace: release.namespace, image: release.image });
});
