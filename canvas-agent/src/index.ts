#!/usr/bin/env node
if (process.argv[2] === "mcp" && process.argv.includes("--control")) {
    const { startControlMcpServer } = await import("./server/control-mcp.js");
    await startControlMcpServer();
} else if (process.argv[2] === "mcp") {
    const { startMcpServer } = await import("./server/mcp.js");
    await startMcpServer();
} else {
    const { startHttpServer } = await import("./server/http.js");
    startHttpServer();
}
