import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { controlToolNames } from "../canvas/control.js";
import { toolDescriptions, toolInputSchemas } from "../canvas/schemas.js";
import { VERSION } from "../config.js";
import { redactAgentLog } from "../utils/agent-runtime.js";
import { startControlBridge } from "./control.js";

/** 独立画布控制模式：MCP 与本机桥接共享生命周期，不初始化内置 AI 对话。 */
export async function startControlMcpServer() {
    const bridge = await startControlBridge();
    const server = new McpServer({ name: "cherry-canvas", version: VERSION }, { instructions: "用 canvas_open 打开画布，在网页明确授权后操作。每次会话只控制已授权画布。先读取状态，批量操作只引用存在或本批创建的节点 ID。生成需要额外授权；提交成功不代表生成完成，用 generation_get_status 查询。结构化快照不是截图，truncatedFields 标记摘要，不要据此覆盖完整正文。写操作断线或超时后结果未知，不要自动重试，应重新授权并读取状态确认。本模式不接收外部聊天附件，不操作工作台、素材库或模型配置。" });
    const result = async (invoke: () => Promise<unknown> | unknown) => {
        try { return { content: [{ type: "text" as const, text: JSON.stringify(await invoke()) ?? "null" }] }; }
        catch (error) { return { isError: true, content: [{ type: "text" as const, text: redactAgentLog(error instanceof Error ? error.message : "画布控制失败") }] }; }
    };
    server.registerTool("canvas_open", { description: "在本机浏览器打开线上画布并等待用户授权；不会启动网页内置 AI 对话。", inputSchema: { mode: z.enum(["new", "choose"]).default("choose") } }, ({ mode }) => result(() => bridge.openCanvas(mode)));
    server.registerTool("canvas_get_connection_status", { description: "查询本次画布控制连接、授权状态与目标画布，不返回连接凭据。", inputSchema: {} }, () => result(bridge.status));
    for (const name of [...controlToolNames, "generation_get_status" as const]) {
        const description = name === "canvas_export_snapshot" ? "读取授权画布的结构化快照，不包含截图或图片内容。" : name === "generation_get_status" ? "查询已授权画布生成节点的状态，仅支持 scope=canvas 和 nodeIds，不查询工作台。" : toolDescriptions[name];
        const inputSchema = name === "generation_get_status" ? { scope: z.literal("canvas").optional(), nodeIds: z.array(z.string()).optional(), limit: z.number().optional() } : toolInputSchemas[name].shape;
        server.registerTool(name, { description, inputSchema }, (input: unknown, extra) => result(() => bridge.callTool(name, input, extra.signal)));
    }
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        bridge.close();
        void server.close();
    };
    server.server.onclose = close;
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    try { await server.connect(new StdioServerTransport()); }
    catch (error) { close(); throw error; }
}
