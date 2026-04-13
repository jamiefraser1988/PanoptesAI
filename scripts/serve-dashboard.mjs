import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "artifacts", "modarchitect", "dist", "public");
const indexFile = path.join(publicDir, "index.html");
const host = "0.0.0.0";
const port = Number(process.env.PORT ?? "8080");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

if (!existsSync(indexFile)) {
  console.error(`Dashboard build output not found at ${indexFile}. Run the dashboard build first.`);
  process.exit(1);
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isInsidePublicDir(candidatePath) {
  const relative = path.relative(publicDir, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendFile(res, filePath, method, statusCode = 200) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) ?? "application/octet-stream";
  const fileStat = statSync(filePath);

  res.writeHead(statusCode, {
    "Content-Length": fileStat.size,
    "Content-Type": contentType,
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });

  if (method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function resolveFilePath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const decodedPathname = safeDecodePathname(url.pathname);
  if (!decodedPathname) {
    return { kind: "bad-request" };
  }

  const trimmedPath = decodedPathname.replace(/^\/+/, "");
  if (trimmedPath === "") {
    return { kind: "file", path: indexFile };
  }

  const candidatePath = path.resolve(publicDir, trimmedPath);
  if (!isInsidePublicDir(candidatePath)) {
    return { kind: "bad-request" };
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    return { kind: "file", path: candidatePath };
  }

  if (path.extname(trimmedPath)) {
    return { kind: "missing" };
  }

  return { kind: "file", path: indexFile };
}

const server = http.createServer((req, res) => {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const resolved = resolveFilePath(req.url ?? "/");
  if (resolved.kind === "bad-request") {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  if (resolved.kind === "missing") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  sendFile(res, resolved.path, method);
});

server.listen(port, host, () => {
  console.log(`Serving PanoptesAI dashboard from ${publicDir} on http://${host}:${port}`);
});
