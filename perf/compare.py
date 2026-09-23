#!/usr/bin/env python3
"""Compare two k6 --summary-export files (base vs head) and fail on regressions.

Both builds run back to back on the same CI runner against a fresh Postgres, so
runner-to-runner noise cancels out. An endpoint regresses when its p95 is more than
THRESHOLD slower *and* at least MIN_DELTA_MS slower (ignores jitter on fast calls).
"""
import json
import os
import re
import sys

THRESHOLD = float(os.environ.get("PERF_THRESHOLD", "1.25"))
MIN_DELTA_MS = float(os.environ.get("PERF_MIN_DELTA_MS", "5"))
MAX_ERROR_RATE = float(os.environ.get("PERF_MAX_ERROR_RATE", "0.01"))


def load(path):
    with open(path) as f:
        metrics = json.load(f)["metrics"]
    p95 = {}
    for key, m in metrics.items():
        match = re.fullmatch(r"http_req_duration\{name:(.+)\}", key)
        if match:
            p95[match.group(1)] = m["p(95)"]
    errors = metrics.get("http_req_failed", {}).get("value", 0.0)
    return p95, errors


def main(base_path, head_path):
    base, base_err = load(base_path)
    head, head_err = load(head_path)

    rows, failed = [], False
    for name in sorted(head):
        b, h = base.get(name), head[name]
        if b is None:
            rows.append((name, "-", f"{h:.1f}", "-", "new"))
            continue
        ratio = h / b if b else float("inf")
        regressed = ratio > THRESHOLD and (h - b) > MIN_DELTA_MS
        failed |= regressed
        rows.append((name, f"{b:.1f}", f"{h:.1f}", f"{ratio:.2f}x", "REGRESSION" if regressed else "ok"))

    if head_err > MAX_ERROR_RATE:
        failed = True

    out = [
        "## Performance check (p95 latency, ms)",
        "",
        f"Fails if p95 > {THRESHOLD:.2f}x base and > {MIN_DELTA_MS:.0f} ms slower, or error rate > {MAX_ERROR_RATE:.0%}.",
        "",
        "| endpoint | base | head | ratio | result |",
        "|---|---|---|---|---|",
        *[f"| {' | '.join(r)} |" for r in rows],
        "",
        f"Error rate: base {base_err:.2%}, head {head_err:.2%}",
    ]
    report = "\n".join(out)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(report + "\n")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
