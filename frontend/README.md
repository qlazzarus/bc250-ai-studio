# BC-250 Art Studio web client

The Art Studio is a Vite/React client for the Phase 1 Studio API. It automatically connects to `/api/v1` using the build-time client key, submits jobs with `source: "nsfw"`, shows queue state, and
displays generated assets and their reproducibility metadata.
It also supports a recoverable archive view; deletion is available only from that
view and moves the image plus metadata to the private Studio trash directory.

## Local development through the SSH tunnel

Keep the existing tunnel open on the Mac:

```sh
ssh -N -L 18090:127.0.0.1:8090 USER@BC250_HOST
```

Then run the UI locally:

```sh
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Set `VITE_STUDIO_API_KEY` in `frontend/.env.local` to the server’s `STUDIO_API_KEY`,
then open `http://127.0.0.1:5173`. Vite proxies `/api` to
the tunnel target, so the browser does not need a CORS exception on BC-250.

## Build

```sh
npm run lint
npm run build
```

For GitHub Actions deployments, set the `BC250_STUDIO_API_KEY` secret in the `production` environment (or repository secrets) to the server’s `STUDIO_API_KEY`. The workflow supplies it as `VITE_STUDIO_API_KEY` at build time and fails if it is missing. For local builds, set `VITE_STUDIO_API_KEY` yourself. It is embedded in the browser bundle and visible to anyone who can access the site; restrict access to the site accordingly. Existing tabs with a previously saved session key can use it until closed when no build-time key is configured.

`dist/` is a static site. For a LAN deployment, serve it behind a reverse proxy
which sends `/api/` to the Studio service on `127.0.0.1:8090`; do not expose the
Studio service's loopback port directly.
