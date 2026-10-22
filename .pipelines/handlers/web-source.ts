import { join } from "node:path";
import { implement } from "@olve/pipelines";
import { webSource } from "../pipeline";

export default implement(webSource, async ({ source }, ctx) => {
  const tree = await ctx.files.fetch(source.tree);
  return { ...source, tree: await ctx.output.dir(join(tree, "src/frontend"), { name: "tree" }) };
});
