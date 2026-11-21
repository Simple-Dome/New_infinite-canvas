import crypto from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import express, { type Request, type Response } from "express";
import open from "open";
import { z } from "zod";

import { CONTROL_PROTOCOL_VERSION, controlPermissionsSchema, controlSnapshot, controlToolNames, isControlReadTool, validateControlOps, type ControlPermissions } from "../canvas/control.js";
import { CanvasSession, type CanvasControlTarget } from "../canvas/session.js";
import { toolInputSchemas, type ToolName } from "../canvas/schemas.js";
import type { CanvasSnapshot } from "../canvas/types.js";

type Grant = { id: string; clientId: string; projectId: string; permissions: ControlPermissions; revision: number };
const snapshotSchema = z.object({
    projectId: z.string().min(1), title: z.string().optional(),
    nodes: z.array(z.object({ id: z.string(), type: z.string(), position: z.object({ x: z.number().finite(), y: z.number().finite() }), width: z.number().finite().positive(), height: z.number().finite().positive(), metadata: z.record(z.unknown()).optional() }).passthrough()),
    connections: z.array(z.object({ id: z.string(), fromNodeId: z.string(), toNodeId: z.string() })),
    selectedNodeIds: z.array(z.string()), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }),
});

/** 每个 MCP 进程独占桥接、随机凭据和授权，不读写旧 Agent 配置或对话。 */
export async function startControlBridge() {
    const site = new URL(process.env.CANVAS_CONTROL_SITE_URL || "https://image.cherryai.cn/");
    if (site.username || site.password || site.search || site.hash || (site.protocol !== "https:" && !(site.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(site.hostname)))) throw new Error("画布地址须为 HTTPS，或本机开发 HTTP 地址，且不能包含凭据、查询参数和片段");
    if (!site.pathname.endsWith("/")) site.pathname += "/";
    const session = new CanvasSession();
    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(18).toString("hex");
    let grant: Grant | null = null;
    let server!: Server;
    const sockets = new Set<Socket>();
    let endpoint = "";
    let openError = "";
    const app = express();
    app.disable("x-powered-by");
    app.use((req, res, next) => {
        if (req.headers.host !== new URL(endpoint).host || req.headers.origin !== site.origin) return void res.status(403).json({ error: "画布来源不允许连接" });
        res.setHeader("Access-Control-Allow-Origin", site.origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-control-token");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        if (req.method === "OPTIONS") return void res.sendStatus(204);
        if (req.get("x-canvas-control-token") !== token && req.query.token !== token) return void res.status(401).json({ error: "控制凭据无效，请重新打开画布" });
        next();
    });
    // 沿用完整 Agent 的请求体上限，不引入新的大小边界。
    app.use(express.json({ limit: "30mb" }));

    function revoke() {
        const previous = grant;
        grant = null;
        if (previous) session.disconnectClient(previous.clientId);
    }

    function requireGrant(clientId?: string, grantId?: string, projectId?: string) {
        if (!grant || !session.hasClient(grant.clientId) || (clientId !== undefined && grant.clientId !== clientId) || (grantId !== undefined && grant.id !== grantId) || (projectId !== undefined && grant.projectId !== projectId)) throw new Error("控制授权不存在或已撤销，请在目标画布重新授权");
        return grant;
    }

    function route(handler: (req: Request, res: Response) => void) {
        return (req: Request, res: Response) => {
            try { handler(req, res); }
            catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "控制请求失败" }); }
        };
    }

    app.get("/events", route((req, res) => {
        const clientId = z.string().min(1).parse(req.query.clientId);
        if (grant && grant.clientId !== clientId) throw new Error("本会话已绑定其他网页，请先在原网页断开");
        if (session.hasClient(clientId)) {
            if (grant) throw new Error("网页连接已存在，请先断开原会话");
            session.disconnectClient(clientId);
        }
        session.openEvents(new URL(req.originalUrl, endpoint), res, "", { protocolVersion: CONTROL_PROTOCOL_VERSION, sessionId, clientId, mode: "control" });
        res.on("close", () => { if (grant?.clientId === clientId && !session.hasClient(clientId)) revoke(); });
    }));
    app.post("/authorize", route((req, res) => {
        const body = z.object({ clientId: z.string(), permissions: controlPermissionsSchema, snapshot: snapshotSchema, revision: z.number().int().nonnegative() }).parse(req.body);
        if (!session.hasClient(body.clientId)) throw new Error("请先连接网页");
        if (grant) throw new Error("已有控制授权，请先断开原会话");
        if (body.permissions.generate && !body.permissions.edit) throw new Error("生成需要同时允许编辑画布");
        grant = { id: crypto.randomUUID(), clientId: body.clientId, projectId: body.snapshot.projectId, permissions: body.permissions, revision: body.revision };
        session.updateState(body.snapshot, body.clientId);
        res.json({ grantId: grant.id, projectId: grant.projectId });
    }));
    app.post("/state", route((req, res) => {
        const current = requireGrant(String(req.query.clientId || ""), String(req.query.grantId || ""));
        const { snapshot, revision } = z.object({ snapshot: snapshotSchema, revision: z.number().int().nonnegative() }).parse(req.body);
        if (snapshot.projectId !== current.projectId) { revoke(); throw new Error("画布已切换，原控制授权已撤销"); }
        if (revision > current.revision) {
            current.revision = revision;
            session.updateState(snapshot, current.clientId);
        }
        res.json({ ok: true });
    }));
    app.post("/result", route((req, res) => {
        const current = requireGrant(String(req.query.clientId || ""), String(req.body?.grantId || ""), String(req.body?.projectId || ""));
        let snapshot: CanvasSnapshot | undefined;
        if (!req.body?.error) {
            const revision = z.number().int().nonnegative().parse(req.body?.revision);
            const reported = snapshotSchema.parse(req.body?.snapshot) as unknown as CanvasSnapshot;
            if (reported.projectId !== current.projectId) { revoke(); throw new Error("画布已切换，原控制授权已撤销"); }
            snapshot = revision >= current.revision ? reported : session.canvasStateForClient(current.clientId) || undefined;
            current.revision = Math.max(revision, current.revision);
        }
        const ok = session.resolveResult(current.clientId, { ...req.body, snapshot });
        res.status(ok ? 200 : 409).json({ ok });
    }));
    app.get("/check", route((req, res) => {
        const current = requireGrant(String(req.query.clientId || ""), String(req.query.grantId || ""), String(req.query.projectId || ""));
        res.json({ active: session.isControlRequestPending(String(req.query.requestId || ""), current.clientId, current.id) });
    }));
    app.post("/disconnect", route((req, res) => {
        requireGrant(String(req.body?.clientId || ""), String(req.body?.grantId || ""));
        revoke();
        res.json({ ok: true });
    }));
    app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
        res.status(400).json({ error: error instanceof Error ? error.message : "请求无效" });
    });
    await new Promise<void>((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("无法取得本机控制地址"));
            endpoint = `http://127.0.0.1:${address.port}`;
            resolve();
        });
        server.once("error", reject);
        server.on("connection", (socket) => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
    });

    function status() {
        return { mode: "control", protocolVersion: CONTROL_PROTOCOL_VERSION, site: site.href, status: grant ? "authorized" : session.health().clients ? "waiting_for_authorization" : "waiting_for_browser", projectId: grant?.projectId, title: grant ? session.canvasStateForClient(grant.clientId)?.title : undefined, permissions: grant?.permissions, ...(openError ? { openError } : {}) };
    }

    return {
        status,
        async openCanvas(mode: "new" | "choose") {
            if (grant) return status();
            const url = new URL("canvas", site);
            url.searchParams.set("mode", mode);
            url.searchParams.set("control", "1");
            url.hash = new URLSearchParams({ controlUrl: endpoint, controlToken: token }).toString();
            openError = "";
            const child = await open(url.href, { wait: false });
            await new Promise<void>((resolve, reject) => {
                child.once("error", () => { openError = "无法启动系统浏览器，请检查本机浏览器配置"; reject(new Error(openError)); });
                if (child.pid) resolve();
                else child.once("spawn", resolve);
            });
            child.once("exit", (code) => { if (code) openError = `系统打开浏览器失败，退出码 ${code}`; });
            return { ...status(), openingRequested: true, next: "在网页选择或新建画布，然后确认本次控制授权；用 canvas_get_connection_status 查询状态。" };
        },
        async callTool(name: ToolName, rawInput: unknown, signal?: AbortSignal) {
            if (!controlToolNames.includes(name) && name !== "generation_get_status") throw new Error("该工具不在画布控制范围内");
            const input = toolInputSchemas[name].parse(rawInput) as Record<string, unknown>;
            if (name === "generation_get_status" && ((input.scope && input.scope !== "canvas") || input.taskId)) throw new Error("本模式仅查询授权画布的生成节点，请使用 nodeIds");
            const current = requireGrant();
            const target: CanvasControlTarget = {
                clientId: current.clientId, projectId: current.projectId, grantId: current.id, signal,
                validate: () => { requireGrant(current.clientId, current.id, current.projectId); },
                validateOps: (ops, state) => validateControlOps(ops, current.permissions, state),
            };
            if (!isControlReadTool(name)) await session.callTool("canvas_get_state", {}, target);
            const before = session.canvasStateForClient(current.clientId);
            await session.callTool(name, input, target);
            target.validate();
            const snapshot = session.canvasStateForClient(current.clientId)!;
            const safe = controlSnapshot(snapshot);
            if (name === "canvas_get_selection") return { projectId: safe.projectId, nodes: safe.nodes.filter((node) => safe.selectedNodeIds.includes(node.id)) };
            if (name === "generation_get_status") {
                const ids = Array.isArray(input.nodeIds) ? input.nodeIds : [];
                const tasks = safe.nodes.filter((node) => ids.length ? ids.includes(node.id) : node.type === "config" || node.metadata.generationMode || node.metadata.model || ["loading", "error"].includes(String(node.metadata.status))).map((node) => ({ nodeId: node.id, title: node.title, mode: node.metadata.generationMode || node.type, status: node.metadata.status === "loading" ? "running" : node.metadata.status === "success" ? "succeeded" : node.metadata.status === "error" ? "failed" : "idle" }));
                const summary = { idle: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
                for (const task of tasks) summary[task.status as keyof typeof summary]++;
                // 沿用原 generation_get_status 的默认值与范围。
                const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit)) || 20));
                return { projectId: safe.projectId, total: tasks.length, summary, tasks: tasks.slice(0, limit) };
            }
            if (isControlReadTool(name)) return safe;
            const previous = new Set(before?.nodes?.map((node) => node.id));
            return { applied: true, projectId: snapshot.projectId, createdNodeIds: snapshot.nodes?.filter((node) => !previous.has(node.id)).map((node) => node.id), persistence: "已应用到网页，沿用浏览器本地保存流程；此结果不代表已落盘。", generation: "生成操作为异步提交，请用 generation_get_status 查询最终状态。" };
        },
        close() {
            revoke();
            session.closeControlConnections();
            server.close();
            for (const socket of sockets) socket.destroy();
        },
    };
}
