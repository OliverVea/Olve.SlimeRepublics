import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuiltImage, Ctx, Infer, Source } from "@olve/pipelines";

const HOST = "oliver@bulwark-m2";
const RELEASE = "olve-slimerepublics";
// kubelet only sees images in the k3s containerd's k8s.io namespace.
const K3S_IMPORT = "sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io load";

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

type Image = Infer<typeof BuiltImage>;

export async function deploy(
  ctx: Ctx,
  { source, server, web }: { source: Infer<typeof Source>; server: Image; web: Image },
  namespace: string,
) {
  const tree = await ctx.files.fetch(source.tree);

  await ctx.exec(["apk", "add", "--no-cache", "openssh-client"]);
  const dir = join(ctx.tmpDir, "ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyFile = join(dir, "id");
  const key = ctx.secrets.SSH_PRIVATE_KEY!;
  writeFileSync(keyFile, key.endsWith("\n") ? key : key + "\n", { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const opts = ["-i", keyFile, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "BatchMode=yes"];
  const ssh = (remote: string) => ctx.exec(["ssh", ...opts, HOST, remote]);

  for (const image of [server, web]) {
    ctx.log("importing image", { image: `${image.repository}:${image.tag}` });
    const tar = await ctx.files.fetch(image.tar);
    await ctx.sh(`${["ssh", ...opts, HOST, K3S_IMPORT].map(q).join(" ")} < ${q(tar)}`);
  }

  const remoteChart = `/tmp/${RELEASE}-helm-${namespace}`;
  await ssh(`rm -rf ${remoteChart}`);
  await ctx.exec(["scp", ...opts, "-r", join(tree, "helm"), `${HOST}:${remoteChart}`]);
  ctx.log("helm upgrade", { release: RELEASE, namespace });
  await ssh(
    `cd ${remoteChart} && helm upgrade --install ${RELEASE} . -n ${namespace}`
    + ` --set image.repository=${server.repository} --set image.tag=${server.tag} --set image.pullPolicy=Never`
    + ` --set web.image.repository=${web.repository} --set web.image.tag=${web.tag} --set web.image.pullPolicy=Never`
    + ` && cd / && rm -rf ${remoteChart}`,
  );
  for (const deployment of [`${RELEASE}-server`, `${RELEASE}-web`]) {
    await ssh(`kubectl -n ${namespace} rollout status deploy/${deployment} --timeout=120s`);
  }
  return { release: RELEASE, namespace, image: `${server.repository}:${server.tag}` };
}
