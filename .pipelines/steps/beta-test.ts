import { join } from "node:path";
import { implement, step, HelmRelease, Source } from "@olivervea/pipelines";
import { BETA, checkClient, firstMessage } from "../lib/checks";

// Bots join the world for a minute, so this runs against beta only.
export const betaTest = implement(step({
  name: "beta-test",
  description: "Checks the client and a WebSocket through slimes-beta.ovea.pro, then bots play on beta for a minute (`npm run smoke`).",
  image: "node:24-alpine",
  input: { source: Source, release: HelmRelease },
  timeoutSeconds: 600,
}), async ({ source, release }, ctx) => {
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
