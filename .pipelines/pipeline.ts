// Every push goes beta, then prod. config.yaml beside it is the paused v1 deployer's rollback path.
import { BuiltImage, HelmRelease, pipeline, secret, Source, step, steps } from "@olve/pipelines";
import * as M from "./models";

export const GITHUB_TOKEN = secret("GITHUB_TOKEN", "GitHub read token used to fetch the repo tarball.");
export const SSH_PRIVATE_KEY = secret("SSH_PRIVATE_KEY", "SSH key for importing the images and running helm on the homelab host.");

export const source = steps.gitHubSource({
  name: "source",
  description: "Fetches the pushed commit from GitHub.",
  token: GITHUB_TOKEN,
});

export const webSource = step({
  name: "web-source",
  description: "Cuts src/frontend out of the source tree: the web image's build context.",
  image: "alpine:3.22",
  input: { source: Source },
  output: Source,
  timeoutSeconds: 120,
});

export const buildServer = steps.imageBuild({
  name: "build-server",
  description: "Builds the game server image with kaniko; the Catch2 suite runs inside the build.",
  repository: "olve-slimerepublics",
  stallTimeoutSeconds: 600,
  timeoutSeconds: 3600,
});

export const buildWeb = steps.imageBuild({
  name: "build-web",
  description: "Builds the web image (the client behind nginx, which proxies /ws to the server) with kaniko.",
  repository: "olve-slimerepublics-web",
  timeoutSeconds: 1200,
});

export const test = step({
  name: "test",
  description: "Frontend checks: Biome, the Vitest suite, typecheck and production build.",
  image: "node:24-alpine",
  input: { source: Source },
  timeoutSeconds: 900,
});

const deployInput = { source: Source, server: BuiltImage, web: BuiltImage };

export const deployBeta = step({
  name: "deploy-beta",
  description: "Imports both images on the node and deploys them to apps-beta with Helm.",
  image: "alpine:3.22",
  input: deployInput,
  output: HelmRelease,
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 900,
});

export const betaTest = step({
  name: "beta-test",
  description: "Checks the client and a WebSocket through slimes-beta.ovea.pro, then bots play on beta for a minute (`npm run smoke`).",
  image: "node:24-alpine",
  input: { source: Source, release: HelmRelease },
  timeoutSeconds: 600,
});

export const deployProd = step({
  name: "deploy-prod",
  description: "Imports both images on the node and deploys them to apps with Helm.",
  image: "alpine:3.22",
  input: deployInput,
  output: HelmRelease,
  secrets: [SSH_PRIVATE_KEY],
  timeoutSeconds: 900,
});

export const prodTest = step({
  name: "prod-test",
  description: "Read-only check of slimes.ovea.pro: the client is served and one WebSocket gets a message from the server.",
  image: "alpine:3.22",
  input: { release: HelmRelease },
  timeoutSeconds: 180,
});

export default pipeline({
  name: "Olve.SlimeRepublics",
  description: "Build the game server and web images with kaniko beside the frontend checks, deploy to apps-beta with Helm and let bots play on it, then deploy the same images to apps and check prod read-only. deployTo=beta stops after beta.",
  input: M.DeployRequest,
})
  .onPush(e => ({ repo: e.repository.full_name, sha: e.after, deployTo: "prod" }))
  .stage([source, from => ({ repo: from.input.repo, sha: from.input.sha })])
  .stage([webSource, from => ({ source: from.source })])
  .stage(
    [buildServer, from => ({ source: from.source })],
    [buildWeb, from => ({ source: from["web-source"] })],
    [test, from => ({ source: from.source })],
  )
  .stage([deployBeta, from => ({ source: from.source, server: from["build-server"], web: from["build-web"] })])
  .stage([betaTest, from => ({ source: from.source, release: from["deploy-beta"] })])
  .when({ deployTo: "prod" }, p => p
    .stage([deployProd, from => ({ source: from.source, server: from["build-server"], web: from["build-web"] })])
    .stage([prodTest, from => ({ release: from["deploy-prod"] })]));
