// Local preview: run node scripts/build.ts, then node scripts/serve.ts and open http://localhost:8080/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { ROOT } from "./lib.ts";

const DIR = join(ROOT, "_site");
const PORT = Number(process.env.PORT || 8080);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
};

createServer(async (req, res) => {
  let p = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  try {
    const body = await readFile(join(DIR, p));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
