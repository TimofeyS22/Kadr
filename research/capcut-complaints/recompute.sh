#!/bin/sh
# All numbers of the report from the frozen snapshot (data/, outside git). docs/15 §1.
cd "$(dirname "$0")" && python3 -I analyze.py && python3 -I strength.py > /dev/null && python3 -I series.py && python3 -I manifest.py
