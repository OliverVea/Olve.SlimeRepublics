// Every push goes beta, then prod.
import { pipeline, steps } from "@olivervea/pipelines";
import * as M from "./models";
import { GITHUB_TOKEN, REGISTRY_MAP, SSH_PRIVATE_KEY } from "./shared";
import { betaTest } from "./steps/beta-test";
import { prodTest } from "./steps/prod-test";
import { test } from "./steps/test";

const source = steps.gitHubSource({
  name: "source",
  description: "Fetches the pushed commit from GitHub.",
  token: GITHUB_TOKEN,
});

const buildServer = steps.imageBuild({
  name: "build-server",
  description: "Builds the game server image with kaniko; the Catch2 suite runs inside the build.",
  repository: "olve-slimerepublics",
  cacheRepo: "registry.ovea.pro/olve-slimerepublics/cache",
  stallTimeoutSeconds: 600,
  registryMap: REGISTRY_MAP,
  timeoutSeconds: 3600,
});

const buildWeb = steps.imageBuild({
  name: "build-web",
  description: "Builds the web image (the client behind nginx, which proxies /ws to the server) with kaniko.",
  repository: "olve-slimerepublics-web",
  context: "src/frontend",
  cacheRepo: "registry.ovea.pro/olve-slimerepublics-web/cache",
  registryMap: REGISTRY_MAP,
  timeoutSeconds: 1200,
});

const RELEASE = "olve-slimerepublics";

const deployTo = (namespace: string) => ({
  host: "oliver@bulwark-m2",
  sshKey: SSH_PRIVATE_KEY,
  release: RELEASE,
  namespace,
  chart: "helm",
  images: { server: "image", web: "web.image" },
  deployments: [`${RELEASE}-server`, `${RELEASE}-web`],
  timeoutSeconds: 900,
});

const deployBeta = steps.helmDeployOverSsh({
  name: "deploy-beta",
  description: "Imports both images on the node and deploys them to apps-beta with Helm.",
  ...deployTo("apps-beta"),
});

const deployProd = steps.helmDeployOverSsh({
  name: "deploy-prod",
  description: "Imports both images on the node and deploys them to apps with Helm.",
  ...deployTo("apps"),
});

export default pipeline({
  name: "Olve.SlimeRepublics",
  description: "Build the game server and web images with kaniko beside the frontend checks, deploy to apps-beta with Helm and let bots play on it, then deploy the same images to apps and check prod read-only. deployTo=beta stops after beta.",
  input: M.DeployRequest,
})
  .onPush(e => ({ repo: e.repository.full_name, sha: e.after, deployTo: "prod" }))
  .stage([source, from => ({ repo: from.input.repo, sha: from.input.sha })])
  .stage(buildServer, buildWeb, test)
  .stage([deployBeta, from => ({ source: from.source, server: from["build-server"], web: from["build-web"] })])
  .stage(betaTest)
  .when({ deployTo: "prod" }, p => p
    .stage([deployProd, from => ({ source: from.source, server: from["build-server"], web: from["build-web"] })])
    .stage([prodTest, from => ({ release: from["deploy-prod"] })]));
