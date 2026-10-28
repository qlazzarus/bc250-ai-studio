# BC-250 Art Studio web client

The Art Studio is a Vite/React client for the Phase 1 Studio API. It uses the
browser's `sessionStorage` for the client API key (the key disappears when the
tab is closed), submits jobs with `source: "nsfw"`, shows queue state, and
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

Open `http://127.0.0.1:5173`, use `/api/v1` as the API address, and enter the
same `STUDIO_API_KEY` used for the command-line client. Vite proxies `/api` to
the tunnel target, so the browser does not need a CORS exception on BC-250.

## Build

```sh
npm run lint
npm run build
```

`dist/` is a static site. For a LAN deployment, serve it behind a reverse proxy
which sends `/api/` to the Studio service on `127.0.0.1:8090`; do not expose the
Studio service's loopback port directly.
