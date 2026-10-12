#!/usr/bin/env bash
# tapo-wall launcher — see scripts/start.mjs for the actual logic.
set -euo pipefail

cd "$(dirname "$0")"
exec node scripts/start.mjs "$@"
