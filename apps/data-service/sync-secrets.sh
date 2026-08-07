#!/bin/bash
set -eo pipefail

# Pushes secrets from .${env}.vars to Cloudflare Workers in a single bulk upload.
# Plain configuration (CLOUDFLARE_ENV, ALLOWED_ORIGINS) is NOT handled here — it
# lives in wrangler.jsonc under env.<name>.vars so it stays reviewable in a diff.
# Uses $ROOT_DIR/.env for CF auth (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) if present.
# Usage: ./sync-secrets.sh <env>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: ./sync-secrets.sh <env>"
  echo "Example: ./sync-secrets.sh staging"
  exit 1
fi

ENV="$1"
VARS_FILE="$SCRIPT_DIR/.${ENV}.vars"

if [ ! -f "$VARS_FILE" ]; then
  echo "Error: $VARS_FILE not found"
  exit 1
fi

ENV_FILE_FLAG=()
if [ -f "$ROOT_DIR/.env" ]; then
  ENV_FILE_FLAG=(--env-file "$ROOT_DIR/.env")
fi

# Turn KEY=VALUE lines into the JSON object `wrangler secret bulk` reads from stdin.
# Rejects plain configuration outright, so it cannot drift back into secrets.
SECRETS_JSON=$(node - "$VARS_FILE" "$ENV" <<'NODE'
const { readFileSync } = require("node:fs");

const versionedConfig = ["CLOUDFLARE_ENV", "ALLOWED_ORIGINS"];
const [, , varsFile, targetEnv] = process.argv;
const secrets = {};

for (const line of readFileSync(varsFile, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator === -1) continue;
  const key = trimmed.slice(0, separator).trim();
  if (versionedConfig.includes(key)) {
    console.error(
      `Error: ${key} is versioned configuration — set it in wrangler.jsonc under env.<name>.vars, not in ${varsFile}.`,
    );
    process.exit(1);
  }
  secrets[key] = trimmed.slice(separator + 1).trim();
}

const names = Object.keys(secrets);
if (names.length === 0) {
  console.error(`Error: no secrets found in ${varsFile}`);
  process.exit(1);
}

console.error(`Pushing ${names.length} secrets (${names.join(", ")}) to the ${targetEnv} environment`);
process.stdout.write(JSON.stringify(secrets));
NODE
)

printf '%s' "$SECRETS_JSON" |
  pnpm --filter data-service exec wrangler secret bulk --env "$ENV" "${ENV_FILE_FLAG[@]}"

echo "✓ Secrets synced to $ENV environment"
