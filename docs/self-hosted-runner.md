# Self-hosted GitHub Actions runner

The repository runner `prinpo-stack-pc` runs in an Ubuntu container on the development PC. CI and release preparation select `[self-hosted, Linux, X64, prinpo-stack]`. npm publication remains on GitHub-hosted Ubuntu because [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/#supported-cicd-providers) requires a supported cloud-hosted runner.

The Docker definition lives in `.github/runner/`. A named volume, `prinpo-stack-runner-state`, holds runner registration, workspaces and tool caches. The container mounts neither the host home directory nor the Docker socket, exposes no ports, and runs as the image's `runner` user with Linux capabilities dropped. Docker starts it automatically when the daemon starts. One runner executes one job at a time; builds and tests can use all host CPUs within that job.

## Operate the runner

Run commands from the repository root:

```sh
docker compose -f .github/runner/compose.yaml ps
docker compose -f .github/runner/compose.yaml logs --tail 50
docker compose -f .github/runner/compose.yaml stop
docker compose -f .github/runner/compose.yaml start
```

GitHub shows availability under [Settings → Actions → Runners](https://github.com/prinpo/stack/settings/actions/runners). When the PC or container is offline, matching jobs wait in the queue; there is no automatic hosted fallback. Stopping a busy runner interrupts its current job, so stop it when idle.

To refresh container packages, wait for the runner to become idle, then run:

```sh
docker compose -f .github/runner/compose.yaml build --pull
docker compose -f .github/runner/compose.yaml up -d
```

The runner application updates itself in the persistent volume. Rebuilding the image refreshes the OS packages and Node used by bootstrap commands; workflows install Bun from the package manifest. Release preparation clears its staging directory before each run so old tarballs cannot enter a new artifact. Do not delete the volume during routine maintenance: it includes registration credentials and caches. Treat those credentials as secrets, and never commit the volume's contents or mount personal credentials into the container.

## Register on a replacement PC

Install and start Docker, then build and create the container:

```sh
docker compose -f .github/runner/compose.yaml build --pull
docker compose -f .github/runner/compose.yaml create
```

Follow GitHub's [runner registration instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) for this repository to obtain a short-lived registration token. Configure a one-off Compose container sharing the state volume:

```sh
docker compose -f .github/runner/compose.yaml run --rm --entrypoint ./config.sh runner \
  --url https://github.com/prinpo/stack \
  --name prinpo-stack-pc --labels prinpo-stack --work _work
docker compose -f .github/runner/compose.yaml up -d
```

Enter the token at the configuration prompt and confirm GitHub reports the runner online. Configuration runs as the `runner` user. Do not store the registration token in Compose configuration or a Docker image.

This runner is repository-scoped and intended for this private repository's trusted code. Revisit runner isolation and PR routing before making the repository public or running untrusted contributions on it. Docker here is not a disposable per-job virtual machine; caches and workspaces persist between jobs.
