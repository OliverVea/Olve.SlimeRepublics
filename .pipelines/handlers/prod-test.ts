import { implement } from "@olve/pipelines";
import { prodTest } from "../pipeline";
import { checkClient, firstMessage, PROD } from "./lib/checks";

// Read-only: the page, its bundle and one short-lived socket, through the public host.
export default implement(prodTest, async ({ release }, ctx) => {
  await checkClient(ctx, PROD);
  await ctx.retry({ attempts: 6, delaySeconds: 5 }, () => firstMessage(ctx, PROD));
  ctx.log("prod check passed", { image: release.image });
});
