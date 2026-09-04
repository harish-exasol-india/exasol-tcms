#!/usr/bin/env bash
# Runs every browser and system suite against the running stack.
# Requires `docker compose up -d` and a seeded database with the demo user.
set -u

suites=(auth-flow member-admin repository automation coverage execution concurrency resilience rehearsal acceptance)
failed=0

for s in "${suites[@]}"; do
  printf '%-16s ' "$s"
  if out=$(node "$(dirname "$0")/$s.mjs" 2>&1); then
    # Each suite reports its own tally in its own words; take the last summary line.
    summary=$(echo "$out" | grep -E 'checks passed|steps passed|met, .* not met|Every gap observed' | tail -1)
    echo "${summary:-passed}"
  else
    echo 'FAILED'
    echo "$out" | grep -E '^FAIL|MISMATCH' | head -5 | sed 's/^/    /'
    echo "$out" | tail -4 | sed 's/^/    /'
    failed=1
  fi
done

exit $failed
