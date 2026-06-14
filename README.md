# Njordr

Njordr is a local-first stock risk assessment app built with Next.js. Portfolio data is stored in the browser via IndexedDB/Dexie, and live quote lookups are proxied through the app's `/api/quotes` route using Finnhub.

## Local Docker + Tailscale deployment

This project is containerized as a production Next.js runtime server using Next.js standalone output. The container listens on port `3000`, and Docker Compose publishes it to host port `8080` by default.

### Prerequisites

- Docker and Docker Compose installed on the local PC.
- Tailscale installed, running, and logged in on the local PC if you want access from other tailnet devices.
- A Finnhub API key for live quote refreshes. Get one at <https://finnhub.io/>.

### Configure environment variables

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
FINNHUB_API_KEY=your_finnhub_api_key_here
```

Optional: change the host port by adding `HOST_PORT` to `.env`:

```bash
HOST_PORT=8080
```

Do not commit `.env` or `.env.local`; they may contain secrets.

### Build and run

```bash
docker compose up -d --build
```

Check status and logs:

```bash
docker compose ps
docker compose logs -f
```

Test from the local PC:

```bash
curl http://localhost:8080
```

Open the app in a browser at:

```text
http://localhost:8080
```

### Access over Tailscale

Because Docker publishes the service to the host, other devices on the same tailnet can access it with either the host's Tailscale MagicDNS name or Tailscale IP:

```text
http://<tailscale-device-name>:8080
http://<tailscale-ip>:8080
```

If local access works but Tailscale access does not, verify:

- Tailscale is running and the host appears in the tailnet.
- MagicDNS/device-name resolution works, or use the Tailscale IP directly.
- The host firewall allows inbound connections on the selected `HOST_PORT` from the Tailscale interface.
- `docker compose ps` shows the host port published, for example `0.0.0.0:8080->3000/tcp`.

### Optional: Tailscale Serve HTTPS URL

For a clean HTTPS Tailscale URL without typing a port, keep Tailscale on the host and proxy to the Docker-published port:

```bash
tailscale serve --bg http://127.0.0.1:8080
```

Then access the app using the machine's Tailscale HTTPS MagicDNS name, for example:

```text
https://<machine-name>.<tailnet-name>.ts.net
```

If your installed Tailscale version uses different `tailscale serve` flags for a specific port or path, run:

```bash
tailscale serve --help
```

Do not run Tailscale inside the application container unless you have a specific reason to do so; the simpler model is Docker app on the host plus Tailscale on the host.

### Stop, update, and redeploy

Stop the app:

```bash
docker compose down
```

Pull updates and rebuild:

```bash
git pull
docker compose up -d --build
```

## Development commands

Install dependencies:

```bash
npm ci
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```
