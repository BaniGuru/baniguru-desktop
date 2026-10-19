#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 MANIFEST.json REPORT.json [greedy|beam|kenlm]" >&2
  exit 2
fi
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
export BANI_ASR_EVAL_MANIFEST=$(realpath "$1")
export BANI_ASR_EVAL_REPORT=$(realpath -m "$2")
export BANI_ASR_DECODING=${3:-kenlm}
mkdir -p "$(dirname "$BANI_ASR_EVAL_REPORT")"
build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT
cargo test --manifest-path src-tauri/Cargo.toml --no-run --message-format=json > "$build_log"
test_binary=$(python3 - "$build_log" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    try: item=json.loads(line)
    except json.JSONDecodeError: continue
    if item.get('reason') == 'compiler-artifact' and item.get('profile',{}).get('test') and item.get('executable'):
        print(item['executable'])
PY
)
test_cpus=${BANI_EVAL_CPUS:-$(python3 - <<'PY'
import os
print(','.join(map(str,sorted(os.sched_getaffinity(0))[:4])))
PY
)}
# A 16 GiB virtual-address cap is stricter than a 16 GiB resident-memory cap.
# CPU affinity constrains concurrency; it does not emulate an Intel i5.
exec taskset -c "$test_cpus" prlimit --as=17179869184 -- "$test_binary" \
  asr_reference_evaluation::evaluate_manual_reference_manifest --ignored --nocapture --test-threads=1
