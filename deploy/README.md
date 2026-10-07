# Private Server Deployment

The first-install script creates only Speech Coach resources. It refuses an
existing install and does not edit Caddy, firewall rules, or any other service.

- Application: `/opt/speech-coach-ai/current`
- Private Node runtime: `/opt/speech-coach-ai/runtime`
- Provider configuration: `/var/lib/speech-coach-ai/api-config.json`
- Service: `speech-coach-ai.service`, non-login user `speech-coach`
- Listener: `127.0.0.1:3004`, not a public URL
- Optional trusted HTTPS origin: `SPEECH_COACH_ALLOWED_ORIGIN` in
  `/etc/speech-coach-ai.env`; it must be one exact `https://` origin
- Build limit: 1200 MB, 60% of one CPU; runtime limit: 768 MB

Upload an allowlisted source archive without `.env`, `local-data`, `.git`,
`node_modules`, `.next`, recordings, transcripts, or private documents. Run
`sudo bash deploy/install-first.sh /path/to/source.tar.gz` on a fresh x86_64
systemd Linux installation. A failed build leaves only this project's resources;
inspect the failure before retrying, do not delete or overwrite unrelated paths.

## Access

Until a separately approved HTTPS/private-network setup is ready, use SSH:

```sh
ssh -N -L 127.0.0.1:3004:127.0.0.1:3004 admin@YOUR_SERVER_IP
```

Then open `http://127.0.0.1:3004` on that computer. SSH authenticates access;
the Node service must remain loopback-only. Do not expose it through an open
reverse proxy: the local-only API currently requires loopback Host/Origin checks.
Private or public HTTPS access requires an exact trusted origin plus access
control at the reverse proxy. Never proxy the service publicly without
authentication.

Browser documents, scripts, memories, and recordings stay in IndexedDB, tied to
the exact origin and device. A server deployment does not migrate that data or
enable device synchronization. Re-import documents on the final HTTPS origin.
Provider keys are deliberately not uploaded from the Mac: configure them through
the final protected deployment. On a server they reside on that server, not the
user's iPad; the application remains single-owner, not multi-tenant.

## Operations

```sh
sudo systemctl status speech-coach-ai --no-pager
sudo journalctl -u speech-coach-ai -n 100 --no-pager
sudo systemctl restart speech-coach-ai
sudo systemctl disable --now speech-coach-ai
```

Only restart/stop this named service. None of these commands affects the existing
site on port 8787. Future upgrades should build in a new release directory, retain
`/var/lib/speech-coach-ai`, and switch the `current` symlink only after validation.
