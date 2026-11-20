#!/bin/bash
# Runs a build command; when it fails, puts its last 80 lines into an error annotation on the run, so the reason can be
# read on the run's summary page (and through the public check-runs API) without opening the full log.
#   .github/scripts/run-annotated.sh "<title>" <command...>
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  msg=$(tail -80 "$log" | tr -d '\r' | sed -e 's/%/%25/g' | awk '{ printf "%s%%0A", $0 }')
  echo "::error title=${title} failed::${msg}"
fi
rm -f "$log"
exit "$status"
