# Setup & Test Guide

## 1. Install dependencies

```
cd server
npm install
```

This installs `fastify` and `@fastify/static` into `server/node_modules` (not created by this session — run it yourself).

## 2. Add your Markdown files

Drop `.md` files directly into the `docs/` folder (flat, no subfolders). They're read from disk on every request, so adding/editing a file and refreshing the browser is all that's needed — no restart, no build step.

## 3. Run the server directly (without Nginx)

```
cd server
npm start
```

By default it listens on `http://127.0.0.1:4000`. Open that URL in a browser — you should see the list of `.md` files, and clicking one should render styled HTML with syntax-highlighted code blocks.

Check `logs/access.log` — each request should produce one structured JSON line with `ip`, `userAgent`, `path`, `referer`, `statusCode`, `responseTimeMs`, and a `time` field.

## 4. Put Nginx in front of it

Copy `nginx/sf-utils.conf` into your Nginx sites config (e.g. `/etc/nginx/sites-available/sf-utils.conf`, symlinked into `sites-enabled/`), update `server_name`, then:

```
sudo nginx -t
sudo systemctl reload nginx
```

Keep the Fastify server running on port 4000 (e.g. via `pm2`, `systemd`, or just `npm start` in a terminal/screen session).

## 5. Verify real-IP forwarding

With the server running behind Nginx:

```
curl -H "X-Forwarded-For: 203.0.113.7" http://docs.local/
```

Then check `logs/access.log` — the corresponding entry's `ip` should be `203.0.113.7`, not `127.0.0.1`.

## 6. Verify path-traversal protection

```
curl -i http://docs.local/api/content/..%2F..%2Fserver%2Fserver.js
```

Should return `404`, not the contents of `server.js` — the endpoint only serves names that exactly match a file it just listed in `docs/`.
