import { secret } from "@olivervea/pipelines";

export const GITHUB_TOKEN = secret("GITHUB_TOKEN", "GitHub read token used to fetch the repo tarball.");
export const SSH_PRIVATE_KEY = secret("SSH_PRIVATE_KEY", "SSH key for importing the images and running helm on the homelab host.");
// kaniko under gVisor stalls pulling from these registries directly.
export const REGISTRY_MAP = { "mcr.microsoft.com": "mcr-cache.ovea.pro", "index.docker.io": "hub-cache.ovea.pro" };
