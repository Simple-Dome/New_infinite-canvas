// Runtime branding and analytics, loaded before the application. The container uses a mounted
// /etc/infinite-canvas/config.js when present, otherwise generates analytics from environment variables.
// Empty configuration uses build-time brand defaults and leaves analytics disabled.
window.__RUNTIME_CONFIG__ = window.__RUNTIME_CONFIG__ || {};
