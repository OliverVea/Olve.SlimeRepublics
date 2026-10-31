import { implement, step, HelmRelease } from "@olivervea/pipelines";
import { checkClient, firstMessage, PROD } from "../lib/checks";

// Read-only: the page, its bundle and one short-lived socket, through the public host.
export const prodTest = implement(step({
  name: "prod-test",
  description: "Read-only check of slimes.ovea.pro: the client is served and one WebSocket gets a message from the server.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  timeoutSeconds: 180,
}), async ({ release }, ctx) => {
  await checkClient(ctx, PROD);
  await ctx.retry({ attempts: 6, delaySeconds: 5 }, () => firstMessage(ctx, PROD));
  ctx.log("prod check passed", { image: release.image });
});
