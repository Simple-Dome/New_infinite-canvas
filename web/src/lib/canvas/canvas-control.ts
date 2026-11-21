import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";

export const CANVAS_CONTROL_PROTOCOL_VERSION = 1;
export type CanvasControlPermissions = { edit: boolean; generate: boolean };
export type CanvasControlCall = { requestId: string; grantId: string; projectId: string; name: string; input?: { ops?: CanvasAgentOp[] } };

/** 控制凭据只允许发送给本机桥接，不接受任意远端 endpoint。 */
export function readCanvasControlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (!params.has("controlUrl") && !params.has("controlToken")) return null;
    const url = params.get("controlUrl") || "";
    const token = params.get("controlToken") || "";
    params.delete("controlUrl");
    params.delete("controlToken");
    return { url, token, remainingHash: params.toString() ? `#${params}` : "" };
}

export function validateCanvasControlUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("控制地址必须是本机 127.0.0.1 的 HTTP 服务，请通过 MCP 重新打开画布");
    return url.origin;
}

export function isCanvasControlProjectOpen(projectId: string) {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    return window.location.pathname === new URL(`canvas/${encodeURIComponent(projectId)}`, base).pathname;
}

/** 网页在执行整批操作前再次核实能力边界和节点引用。 */
export function validateCanvasControlOps(ops: CanvasAgentOp[] | undefined, permissions: CanvasControlPermissions, snapshot: CanvasAgentSnapshot) {
    if (!Array.isArray(ops)) throw new Error("画布操作格式无效");
    if (ops.length && !permissions.edit) throw new Error("本次会话未允许编辑画布");
    const allowed = new Set(["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "select_nodes", "set_viewport", "run_generation"]);
    const ids = new Set(snapshot.nodes.map((node) => node.id));
    for (const op of ops) {
        if (!op || !allowed.has(op.type)) throw new Error("包含未开放的画布操作");
        if (op.type === "run_generation" && !permissions.generate) throw new Error("本次会话未允许生成");
        if (op.type === "add_node" && op.id) {
            if (ids.has(op.id)) throw new Error(`节点 ID 已存在：${op.id}`);
            ids.add(op.id);
        }
        if ((op.type === "update_node" && !ids.has(op.id)) || (op.type === "run_generation" && !ids.has(op.nodeId))) throw new Error("操作引用的节点已不存在");
        if (op.type === "update_node" && op.patch && Object.keys(op.patch).some((key) => !["title", "position", "width", "height", "metadata"].includes(key))) throw new Error("不允许更改节点标识或类型");
        if (op.type === "update_node" && op.patch) {
            const node = snapshot.nodes.find((item) => item.id === op.id);
            const freeResize = op.metadata?.freeResize ?? op.patch.metadata?.freeResize ?? node?.metadata?.freeResize;
            if (node?.type === "image" && !freeResize && (op.patch.width !== undefined || op.patch.height !== undefined)) {
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height);
                const width = op.patch.width ?? op.patch.height! * ratio;
                op.patch = { ...op.patch, width, height: width / ratio };
            }
        }
        if (op.type === "connect_nodes" && (!ids.has(op.fromNodeId) || !ids.has(op.toNodeId))) throw new Error("连线引用的节点已不存在");
        if (op.type === "select_nodes" && op.ids.some((id) => !ids.has(id))) throw new Error("选区引用的节点已不存在");
        if (op.type === "delete_node") for (const id of op.ids || (op.id ? [op.id] : [])) ids.delete(id);
    }
    return ops;
}
