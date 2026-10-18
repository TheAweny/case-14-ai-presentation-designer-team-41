# Production delivery from GitHub main

## Scope and architecture

GitHub `TheAweny/case-14-ai-presentation-designer-team-41` is the delivery source. Every push
into `main`, by any teammate, runs the existing complete CI. A successful CI run starts image
builds for that exact commit. Pull requests and failed checks never obtain deployment credentials.
GitHub builds linux/amd64 images and publishes them to private GHCR packages. The server uses
content digests, never mutable tags, and a short-lived job token to pull them.

A dedicated SSH key has a forced command, no shell, forwarding or PTY. The root-owned receiver
accepts only the fixed repository's three image digests and a main commit. Runtime secrets remain
in `/etc/lct/production.env`, not GitHub logs, artifacts or images. Nginx exposes only the web
service; API, engine, search and PostgreSQL are private. Deployment serializes with a host lock,
rejects superseded commits, checks free disk, pulls before stopping anything, snapshots PostgreSQL,
and keeps previous image digests. Failed readiness restores the previous images. Initial failed
installation stops application services and reports failure. No database volumes are removed.

Single-host in-place deployment can briefly interrupt requests and running generations. Migration
changes must use expand/contract and remain compatible with the previous application release;
automatic image rollback never rewinds a live database. Backups support operator recovery, not
a claim of automatic rollback across destructive migrations. Backups on the same disk do not
provide disaster recovery; copying them off-host is an operator responsibility.

## Acceptance tests, written before implementation

1. Reject invalid SHA, wrong repository/image, malformed or non-digest images before mutation.
2. Reject a commit that is no longer GitHub main.
3. Serialize deployments and refuse a concurrent receiver.
4. Pull failure preserves the active release and configuration.
5. Backup failure prevents application replacement.
6. Failed readiness restores previous images; current release stays unchanged.
7. Successful readiness atomically records current and previous manifests without credentials.
8. First-deploy readiness failure stops the unhealthy application and does not record success.
9. Runtime Compose exposes only loopback web and keeps secrets/storage persistent.
10. Live deployment passes HTTPS, authenticated database/engine readiness, unauthenticated access
    rejection, TLS redirect, restart persistence and a deliberately rejected deployment request.

## Operational requirements

Existing lint, types, boundaries, generation checks, tests, build and licenses remain mandatory.
CI/CD changes are committed and pushed to main as part of activating the requested automation.
Production deployment is serialized, scoped to the repository main branch and uses a protected
SSH host key. New infrastructure receiver/Compose versions need an explicit operator install;
normal application changes need only a push to main. The server does not execute repository
scripts or arbitrary SSH commands sent by a job.
