---
title: Deploying Services
tags: [ops, kubernetes]
---
# Deploying Services

## Kubernetes

We deploy every service with Helm charts stored in the `charts/` repo.

### Rollback

If a release misbehaves run `helm rollback <release> <revision>`.
Rollbacks are safe because database migrations are always backwards compatible.

## Docker

Images are built in CI and pushed to the internal registry.
