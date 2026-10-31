import { checkSpa, type Ctx } from "@olivervea/pipelines";

export const BETA = "https://slimes-beta.ovea.pro";
export const PROD = "https://slimes.ovea.pro";

export async function checkClient(ctx: Ctx, origin: string) {
  const { html } = await checkSpa(ctx, origin);
  if (!html.includes("<title>Slime Republics</title>")) throw new Error(`${origin}/ is not the game client`);
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
