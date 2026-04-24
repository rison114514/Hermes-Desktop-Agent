#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 1
fi

has_live_dbus=0
if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  case "$DBUS_SESSION_BUS_ADDRESS" in
    unix:path=*)
      dbus_socket="${DBUS_SESSION_BUS_ADDRESS#unix:path=}"
      if [ -S "$dbus_socket" ]; then
        has_live_dbus=1
      fi
      ;;
  esac
fi

if [ "$has_live_dbus" -eq 1 ] || ! command -v dbus-run-session >/dev/null 2>&1; then
  exec "$@"
fi

exec dbus-run-session -- "$@"
