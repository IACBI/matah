import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../shared/src/index";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same-origin: Vite proxies /socket.io to the game server in dev.
export const socket: GameSocket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});

/** Promise wrapper around an ack-based emit. */
export function emitAck<T>(
  event: keyof ClientToServerEvents,
  ...args: unknown[]
): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    (socket.emit as (e: string, ...a: unknown[]) => void)(
      event,
      ...args,
      (res: { ok: boolean; data?: T; error?: string }) => resolve(res)
    );
  });
}
