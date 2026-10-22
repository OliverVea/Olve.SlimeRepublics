import { model, z } from "@olve/pipelines";

export const DeployRequest = model("DeployRequest", z.object({
  repo: z.string().default("OliverVea/Olve.SlimeRepublics"),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  deployTo: z.enum(["beta", "prod"]).default("prod"),
}));
