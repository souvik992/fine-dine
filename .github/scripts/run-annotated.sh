#!/bin/bash
# Runs a build command; when it fails, puts its last 25 lines (annotations are cut at about 4 KB) into an error annotation on the run, so the reason can be
# read on the run's summary page (and through the public check-runs API) without opening the full log.
#   .github/scripts/run-annotated.sh "<title>" <command...>
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # the error lines first, then the last lines; colours and long lines trimmed to fit
  clean() { tr -d '\r' | sed -e 's/\x1b\[[0-9;]*m//g' | cut -c1-300; }
  msg=$({ grep -iE 'error|⨯|failed|cannot|not found|mismatch' "$log" | clean | tail -12; echo '--- last lines ---'; clean < "$log" | tail -10; } | sed -e 's/%/%25/g' | awk '{ printf "%s%%0A", $0 }')
  echo "::error title=${title} failed::${msg}"
fi
rm -f "$log"
exit "$status"
