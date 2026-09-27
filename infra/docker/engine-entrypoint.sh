#!/bin/sh
set -eu

# I refresh the font index after read-only template font mounts become available.
fc-cache -f
exec "$@"
