#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec /usr/bin/open "$ROOT/../野图.app"
