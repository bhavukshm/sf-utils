const path = require("path");
const fs = require("fs");
const fastifyStatic = require("@fastify/static");

const docsDir = path.join(__dirname, "..", "docs");
const publicDir = path.join(__dirname, "..", "public");
const logsDir = path.join(__dirname, "..", "logs");

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const fastify = require("fastify")({
  // Fastify's logger IS Pino - no pino-http needed.
  logger: {
    level: "info",
    file: path.join(logsDir, "access.log"),
  },
  // Behind Nginx: trust X-Forwarded-For/X-Real-IP so request.ip is the real client IP.
  trustProxy: true,
});

fastify.addHook("onResponse", (request, reply, done) => {
  request.log.info(
    {
      ip: request.ip,
      userAgent: request.headers["user-agent"] || null,
      path: request.url,
      referer:
        request.headers["referer"] || request.headers["referrer"] || null,
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime,
    },
    "request completed",
  );
  done();
});

async function listDocFiles() {
  const entries = await fs.promises.readdir(docsDir, { withFileTypes: true });
  return entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      const name = entry.name.toLowerCase();
      return name.endsWith(".md") || name.endsWith(".html");
    })
    .map((entry) => entry.name)
    .sort();
}

fastify.get("/api/files", async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  return listDocFiles();
});

fastify.get("/api/content/:name", async (request, reply) => {
  // Only serve names that exactly match a file we just listed from docsDir -
  // this rules out path traversal without needing manual path-resolution checks.
  const files = await listDocFiles();
  if (!files.includes(request.params.name)) {
    reply.code(404);
    return { error: "Not found" };
  }

  const content = await fs.promises.readFile(
    path.join(docsDir, request.params.name),
    "utf8",
  );
  reply.header("Cache-Control", "no-store");
  reply.type("text/plain; charset=utf-8");
  return content;
});

fastify.register(fastifyStatic, {
  root: publicDir,
  cacheControl: false,
});

const PORT = process.env.PORT || 2929;
const HOST = process.env.HOST || "127.0.0.1";

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Docs server listening at ${address}`);
});
