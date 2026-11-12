/**
 * dsh-copy-txt — Host half.
 *
 * Persists the paste-to-txt settings so they survive restarts:
 *   GET  /copy-txt/settings
 *   POST /copy-txt/settings
 *
 * Config lives in <DSH_HOME>/plugin-data/<profile>/dsh-copy-txt/config.json
 * (outside the package directory, so plugin updates do not wipe it).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-copy-txt";
export const inject = ["webServer"];

const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;

export const DEFAULTS = {
  enabled: true,
  minChars: 400,
  minLines: 8,
  holdShiftToPaste: true,
};

function deriveProfilePaths(packageDir) {
  const matched = /^(.*)[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/]/i.exec(packageDir);
  return matched === null ? null : { home: matched[1], profile: matched[2] };
}

const DERIVED = deriveProfilePaths(PACKAGE_DIR);
const DSH_HOME = DERIVED !== null
  ? DERIVED.home
  : (typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME !== ""
    ? process.env.DSH_HOME
    : path.join(os.homedir(), ".dsh"));
const PROFILE = DERIVED !== null
  ? DERIVED.profile
  : (typeof process.env.DSH_PROFILE === "string" && process.env.DSH_PROFILE !== ""
    ? process.env.DSH_PROFILE
    : "default");
const DATA_DIR = path.join(DSH_HOME, "plugin-data", PROFILE, "dsh-copy-txt");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isLoopbackAddress(address) {
  const value = address.toLowerCase();
  return value === "::1" || value.startsWith("127.") || value.startsWith("::ffff:127.");
}

function isLoopbackHostname(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

function requestRejection(ctx, req) {
  try {
    const connection = ctx.get("connection");
    if (connection !== undefined && typeof connection.requestRejection === "function") {
      const code = connection.requestRejection(req);
      if (code !== undefined) return code;
      return undefined;
    }
  } catch {
    // Fall back to the local loopback check when the connection service is absent.
  }

  const headers = req.headers ?? {};
  const host = headers.host;
  if (typeof host !== "string" || host === "") return 403;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return 403;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return 403;
  if (headers["sec-fetch-site"] === "cross-site") return 403;
  const origin = headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== hostUrl.host) return 403;
    } catch {
      return 403;
    }
  }
  const remote = req.socket?.remoteAddress;
  if (typeof remote === "string" && remote !== "" && !isLoopbackAddress(remote)) return 403;
  return undefined;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    enabled: src.enabled !== false,
    minChars: clampInt(src.minChars, 1, 100000, DEFAULTS.minChars),
    minLines: clampInt(src.minLines, 1, 10000, DEFAULTS.minLines),
    holdShiftToPaste: src.holdShiftToPaste !== false,
  };
}

async function readSettings() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return { ...DEFAULTS };
    throw error;
  }
}

async function writeSettings(next) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, CONFIG_PATH);
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/copy-txt/settings",
    handler: async (req, res) => {
      const rejection = requestRejection(ctx, req);
      if (rejection !== undefined) {
        json(res, rejection, { ok: false, error: rejection === 401 ? "unauthorized" : "forbidden" });
        return;
      }

      if (req.method === "GET") {
        try {
          json(res, 200, { ok: true, settings: await readSettings() });
        } catch (error) {
          ctx.logger?.error?.("dsh-copy-txt: read settings failed", error);
          json(res, 500, { ok: false, error: "read failed" });
        }
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "GET, POST" });
        res.end();
        return;
      }

      const type = req.headers?.["content-type"];
      if (typeof type !== "string" || !type.toLowerCase().includes("application/json")) {
        json(res, 415, { ok: false, error: "expected application/json" });
        return;
      }

      const raw = await readBody(req);
      if (raw === null) {
        json(res, 413, { ok: false, error: "request too large" });
        return;
      }

      let input;
      try {
        input = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { ok: false, error: "invalid JSON" });
        return;
      }

      const settings = normalizeSettings(input?.settings ?? input);
      try {
        await writeSettings(settings);
        json(res, 200, { ok: true, settings });
      } catch (error) {
        ctx.logger?.error?.("dsh-copy-txt: write settings failed", error);
        json(res, 500, { ok: false, error: "write failed" });
      }
    },
  }), "dsh-copy-txt: settings route");
}
