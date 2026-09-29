import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { connect as netConnect, isIP, type Socket } from "node:net";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";

/**
 * Somewhere to keep the room registry across a restart.
 *
 * One process owns every room, so this is a single opaque blob written on
 * shutdown and every so often while rooms change, and read once at boot.
 */
export interface SnapshotStore {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
  /** Where snapshots go, safe to log: never includes credentials. */
  describe(): string;
}

/** A snapshot file, replaced atomically so a crash mid-write keeps the old one. */
export class FileSnapshotStore implements SnapshotStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<string | null> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(data: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      // Player names and answers are in here; keep it to the service account.
      await writeFile(temp, data, { encoding: "utf8", mode: 0o600 });
      await rename(temp, this.filePath);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  describe(): string {
    return `file ${this.filePath}`;
  }
}

type RespValue = string | number | null | RespValue[];

class RespError extends Error {}

/**
 * Larger than any snapshot this app writes, smaller than what a stuck or
 * hostile peer could make `run()` buffer while it waits for a length it
 * announced. Redis itself caps a value at 512 MiB.
 */
const MAX_REPLY_BYTES = 128 * 1024 * 1024;

/** A RESP length or integer: whole, and within `min`..`max`. */
function respInteger(line: string, min: number, max: number): number {
  const value = Number(line);
  if (line === "" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid RESP length ${JSON.stringify(line.slice(0, 32))}`);
  }
  return value;
}

/**
 * Parse one RESP2 reply starting at `offset`.
 *
 * Returns undefined when the buffer does not yet hold the whole reply, so the
 * caller can wait for more bytes.
 */
export function parseResp(
  buffer: Buffer,
  offset = 0
): { value: RespValue | RespError; next: number } | undefined {
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) return undefined;
  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;
  switch (type) {
    case "+":
      return { value: line, next: afterLine };
    case "-":
      return { value: new RespError(line), next: afterLine };
    case ":":
      return {
        value: respInteger(line, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        next: afterLine,
      };
    case "$": {
      const length = respInteger(line, -1, MAX_REPLY_BYTES);
      if (length === -1) return { value: null, next: afterLine };
      if (buffer.length < afterLine + length + 2) return undefined;
      return {
        value: buffer.toString("utf8", afterLine, afterLine + length),
        next: afterLine + length + 2,
      };
    }
    case "*": {
      const count = respInteger(line, -1, MAX_REPLY_BYTES);
      if (count === -1) return { value: null, next: afterLine };
      const items: RespValue[] = [];
      let cursor = afterLine;
      for (let i = 0; i < count; i += 1) {
        const item = parseResp(buffer, cursor);
        if (!item) return undefined;
        if (item.value instanceof RespError) return { value: item.value, next: item.next };
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`unexpected RESP type byte ${JSON.stringify(type)}`);
  }
}

/** Encode one command as a RESP2 array of bulk strings. */
export function encodeCommand(args: readonly string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const body = Buffer.from(arg, "utf8");
    parts.push(Buffer.from(`$${body.length}\r\n`), body, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

/**
 * The snapshot in one Redis key, with an expiry so a snapshot nobody restores
 * cleans itself up.
 *
 * This speaks just enough RESP2 for AUTH, SELECT, GET and SET over a
 * short-lived connection per call. Snapshots are written every few seconds at
 * most, so a pooled client library would add a dependency and a reconnect
 * state machine to save nothing measurable.
 */
export class RedisSnapshotStore implements SnapshotStore {
  private readonly url: URL;

  constructor(
    url: string,
    private readonly key = "matah:snapshot",
    private readonly ttlSeconds = 900,
    private readonly timeoutMs = 5_000
  ) {
    this.url = new URL(url);
    if (this.url.protocol !== "redis:" && this.url.protocol !== "rediss:") {
      throw new Error("Redis URL must start with redis:// or rediss://");
    }
  }

  async load(): Promise<string | null> {
    const reply = await this.run(["GET", this.key]);
    if (reply !== null && typeof reply !== "string") {
      throw new Error("unexpected Redis reply to GET");
    }
    return reply;
  }

  async save(data: string): Promise<void> {
    const reply = await this.run(["SET", this.key, data, "EX", String(this.ttlSeconds)]);
    if (reply !== "OK") throw new Error("unexpected Redis reply to SET");
  }

  describe(): string {
    return `redis ${this.url.protocol}//${this.url.hostname}:${this.url.port || 6379} key ${this.key}`;
  }

  /** Run one command after any AUTH/SELECT preamble; resolves its reply. */
  private run(command: string[]): Promise<RespValue> {
    const commands: string[][] = [];
    const username = decodeURIComponent(this.url.username);
    const password = decodeURIComponent(this.url.password);
    if (password) commands.push(username ? ["AUTH", username, password] : ["AUTH", password]);
    const db = this.url.pathname.replace(/^\//, "");
    if (db && db !== "0") commands.push(["SELECT", db]);
    commands.push(command);

    // URL keeps the brackets around an IPv6 literal. Bare, isIP() recognises it
    // and no SNI name is sent for it.
    const host = this.url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(this.url.port || 6379);
    return new Promise((resolve, reject) => {
      const socket: Socket =
        this.url.protocol === "rediss:"
          ? tlsConnect({ host, port, ...(isIP(host) ? {} : { servername: host }) })
          : netConnect({ host, port });
      let buffer: Buffer = Buffer.alloc(0);
      const replies: RespValue[] = [];
      let settled = false;
      const finish = (error: Error | null, value?: RespValue) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(value ?? null);
      };

      socket.setTimeout(this.timeoutMs, () => finish(new Error("Redis request timed out")));
      socket.once("error", (error) => finish(error));
      socket.once("close", () => finish(new Error("Redis closed the connection early")));
      socket.once(this.url.protocol === "rediss:" ? "secureConnect" : "connect", () => {
        socket.write(Buffer.concat(commands.map(encodeCommand)));
      });
      socket.on("data", (chunk: Buffer) => {
        buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
        try {
          let parsed = parseResp(buffer);
          while (parsed) {
            // Redis error text never echoes the password it rejected.
            if (parsed.value instanceof RespError) {
              finish(new Error(`Redis error: ${parsed.value.message}`));
              return;
            }
            replies.push(parsed.value);
            buffer = buffer.subarray(parsed.next);
            if (replies.length === commands.length) {
              finish(null, replies.at(-1));
              return;
            }
            parsed = buffer.length > 0 ? parseResp(buffer) : undefined;
          }
        } catch (error) {
          finish(error as Error);
        }
      });
    });
  }
}

/**
 * The configured store, or null when persistence is off.
 *
 * `MATAH_REDIS_URL` wins over `MATAH_SNAPSHOT_FILE`: a host with an ephemeral
 * disk (Render's free plan, most containers) keeps nothing on a file across a
 * redeploy, but keeps a key in a managed Redis.
 */
export function storeFromEnv(env: NodeJS.ProcessEnv): SnapshotStore | null {
  const redisUrl = env.MATAH_REDIS_URL?.trim();
  if (redisUrl) {
    return new RedisSnapshotStore(redisUrl, env.MATAH_SNAPSHOT_KEY?.trim() || undefined);
  }
  const file = env.MATAH_SNAPSHOT_FILE?.trim();
  return file ? new FileSnapshotStore(path.resolve(file)) : null;
}
