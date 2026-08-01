import { io, type Socket } from "socket.io-client";
import type {
  ApiErrorCode,
  ApiResult,
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../shared/src/index";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Give up after this many retries so "unreachable" is a reachable state. */
const RECONNECTION_ATTEMPTS = 12;

// Same-origin: Vite proxies /socket.io to the game server in dev.
export const socket: GameSocket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
  reconnectionAttempts: RECONNECTION_ATTEMPTS,
});

export type ClientErrorCode =
  | ApiErrorCode
  | "request_timeout"
  | "disconnected"
  | "reconnecting";
export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ClientErrorCode };

const ACK_TIMEOUT_MS = 5_000;

/** Promise wrapper around an ack-based emit with a finite failure path. */
export function emitAck<T>(
  event: keyof ClientToServerEvents,
  ...args: unknown[]
): Promise<ClientResult<T>> {
  if (!socket.connected) {
    // Distinguish "the link is coming back" from "the link is gone": the
    // former deserves "reconnecting…", not "server error, try again".
    return Promise.resolve({
      ok: false,
      error: socket.active ? "reconnecting" : "disconnected",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ClientResult<T>) => {
      if (settled) return;
      settled = true;
      socket.off("disconnect", onDisconnect);
      resolve(result);
    };
    const onDisconnect = () => finish({ ok: false, error: "disconnected" });
    socket.once("disconnect", onDisconnect);
    const timedSocket = socket.timeout(ACK_TIMEOUT_MS);
    (timedSocket.emit as (e: string, ...a: unknown[]) => void)(
      event,
      ...args,
      (timeoutError: Error | null, response?: ApiResult<T>) => {
        if (timeoutError || !response) {
          finish({ ok: false, error: "request_timeout" });
          return;
        }
        finish(response);
      }
    );
  });
}
