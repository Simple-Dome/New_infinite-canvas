#!/bin/sh
set -e

# Executed automatically by the official nginx image entrypoint through /docker-entrypoint.d/*.sh before nginx starts.
# A mounted config directory can be edited on the server; page refreshes read its current file.
CONFIG_PATH=/usr/share/nginx/html/config.js
if [ -f /etc/infinite-canvas/config.js ]; then
    ln -sf /etc/infinite-canvas/config.js "$CONFIG_PATH"
    exit 0
fi

# Otherwise generate analytics configuration from container environment variables.

# GA4 and Baidu IDs contain only letters, numbers, and hyphens. Remove other characters
# so quotes and similar values cannot break the JavaScript strings in config.js as a defense-in-depth measure.
sanitize_id() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9-'
}

GA4_ID=$(sanitize_id "${ANALYTICS_GA4_ID:-}")
BAIDU_ID=$(sanitize_id "${ANALYTICS_BAIDU_ID:-}")

cat > "$CONFIG_PATH" <<EOF
window.__RUNTIME_CONFIG__ = {
  ANALYTICS_GA4_ID: "${GA4_ID}",
  ANALYTICS_BAIDU_ID: "${BAIDU_ID}"
};
EOF
chmod 644 "$CONFIG_PATH"
