#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
temp_dir="$(mktemp -d /tmp/zero3-registration-lifecycle.XXXXXX)"
trap 'rm -rf "$temp_dir"' EXIT
cd "$repo_root"

pnpm exec wrangler d1 migrations apply zero3-podio-dev \
  --local --persist-to "$temp_dir/d1" --config wrangler.d1-staging.toml
pnpm exec wrangler d1 execute zero3-podio-dev \
  --local --persist-to "$temp_dir/d1" --config wrangler.d1-staging.toml \
  --file scripts/tests/zero3-registration-lifecycle-d1.sql
