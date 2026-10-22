import type { Ctx } from "@olve/pipelines";

export const BETA = "https://slimes-beta.ovea.pro";
export const PROD = "https://slimes.ovea.pro";

function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(what);
}

export async function checkClient(ctx: Ctx, origin: string) {
  const html = await (await ctx.http.expectOk(`${origin}/`)).text();
  check(html.includes("<title>Slime Republics</title>"), `${origin}/ is not the game client`);
  const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check(bundle !== undefined, `${origin}/ does not reference the client bundle`);
  const js = await ctx.http.expectOk(`${origin}${bundle}`);
  check(js.headers.get("content-type")?.includes("javascript") ?? false, `${bundle} is not served as JavaScript`);
  ctx.log("client served", { origin, bundle });
}

// One socket the way the page opens it (nginx refuses any other Origin); resolves with the first server message's size.
export function firstMessage(ctx: Ctx, origin: string, timeoutMs = 10_000): Promise<number> {
  const url = `${origin.replace(/^http/, "ws")}/ws`;
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    socket.binaryType = "arraybuffer";
    let done = false;
    const finish = (error?: Error, size = 0) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close(1000);
      if (error) reject(error);
      else resolve(size);
    };
    const timer = setTimeout(() => finish(new Error(`no message from ${url} within ${timeoutMs} ms`)), timeoutMs);
    socket.onmessage = (event) => finish(undefined, (event.data as ArrayBuffer).byteLength);
    socket.onclose = (event) => finish(new Error(`${url} closed before a message (code ${event.code})`));
    socket.onerror = () => finish(new Error(`${url} failed to open`));
  }).then((size) => {
    ctx.log("websocket answered", { url, bytes: size });
    return size;
  });
}
