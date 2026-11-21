import { z } from "zod";
import { randomUUID } from "node:crypto";

import type { ToolName } from "./schemas.js";
import type { CanvasSnapshot } from "./types.js";

export const CONTROL_PROTOCOL_VERSION = 1;
export const controlToolNames: ToolName[] = [
    "canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "canvas_apply_ops",
    "canvas_create_node", "canvas_create_text_node", "canvas_create_text_nodes", "canvas_create_config_node",
    "canvas_create_image_prompt_flow", "canvas_create_generation_flow", "canvas_generate_text", "canvas_generate_image",
    "canvas_generate_video", "canvas_generate_audio", "canvas_update_node", "canvas_update_node_text",
    "canvas_move_nodes", "canvas_resize_node", "canvas_delete_nodes", "canvas_connect_nodes", "canvas_select_nodes",
    "canvas_set_viewport", "canvas_run_generation",
];
export const controlPermissionsSchema = z.object({ edit: z.boolean(), generate: z.boolean() }).strict();
export type ControlPermissions = z.infer<typeof controlPermissionsSchema>;

const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const dimensions = { width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional() };
const metadata = z.object({
    content: z.string().optional(), composerContent: z.string().optional(), prompt: z.string().optional(),
    status: z.enum(["idle", "loading", "success", "error"]).optional(), fontSize: z.number().positive().optional(),
    generationMode: z.enum(["text", "image", "video", "audio"]).optional(), model: z.string().optional(),
    size: z.string().optional(), quality: z.string().optional(), count: z.number().int().positive().optional(),
    seconds: z.string().optional(), vquality: z.string().optional(), generateAudio: z.string().optional(),
    watermark: z.string().optional(), videoMode: z.string().optional(), audioVoice: z.string().optional(),
    audioFormat: z.string().optional(), audioSpeed: z.string().optional(), audioInstructions: z.string().optional(),
    freeResize: z.boolean().optional(),
}).strict();
const patch = z.object({ title: z.string().optional(), position: position.optional(), ...dimensions, metadata: metadata.optional() }).strict();
export const controlOpsSchema = z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), id: z.string().optional(), nodeType: z.enum(["text", "image", "config", "video", "audio"]).optional(), title: z.string().optional(), position: position.optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), ...dimensions, metadata: metadata.optional() }).strict(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: patch.optional(), metadata: metadata.optional() }).strict(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).strict(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), toNodeId: z.string() }).strict(),
    z.object({ type: z.literal("select_nodes"), ids: z.array(z.string()) }).strict(),
    z.object({ type: z.literal("set_viewport"), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }).strict() }).strict(),
    z.object({ type: z.literal("run_generation"), nodeId: z.string(), mode: z.enum(["text", "image", "video", "audio"]).optional(), prompt: z.string().optional() }).strict(),
]));

/** 先校验整批操作，再派发；生成授权也覆盖 apply_ops 和 autoRun。 */
export function validateControlOps(input: unknown, permissions: ControlPermissions, state: CanvasSnapshot) {
    const ops = controlOpsSchema.parse(input);
    if (ops.length && !permissions.edit) throw new Error("本次会话未获得编辑授权");
    if (!permissions.generate && ops.some((op) => op.type === "run_generation")) throw new Error("本次会话未获得生成授权");
    const nodes = new Map((state.nodes || []).map((node) => [node.id, node]));
    for (const op of ops) {
        if (op.type === "add_node") {
            op.id ||= `${op.nodeType || "text"}-${randomUUID()}`;
            if (op.id && nodes.has(op.id)) throw new Error(`节点 ID 已存在：${op.id}`);
            if (op.id) nodes.set(op.id, { id: op.id, type: op.nodeType || "text", position: op.position || { x: op.x || 0, y: op.y || 0 }, width: op.width || 1, height: op.height || 1, metadata: op.metadata });
        }
        if (op.type === "update_node") {
            const node = nodes.get(op.id);
            if (!node) throw new Error(`节点不存在：${op.id}`);
            const freeResize = op.metadata?.freeResize ?? op.patch?.metadata?.freeResize ?? node.metadata?.freeResize;
            if (node.type === "image" && !freeResize && (op.patch?.width !== undefined || op.patch?.height !== undefined)) {
                const ratio = (Number(node.metadata?.naturalWidth) || node.width) / (Number(node.metadata?.naturalHeight) || node.height);
                const width = op.patch.width ?? op.patch.height! * ratio;
                op.patch = { ...op.patch, width, height: width / ratio };
            }
            nodes.set(op.id, { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } });
        }
        if (op.type === "connect_nodes" && (!nodes.has(op.fromNodeId) || !nodes.has(op.toNodeId))) throw new Error("连线引用了不存在的节点");
        if (op.type === "run_generation" && !nodes.has(op.nodeId)) throw new Error(`生成节点不存在：${op.nodeId}`);
        if (op.type === "select_nodes" && op.ids.some((id) => !nodes.has(id))) throw new Error("选区引用了不存在的节点");
        if (op.type === "delete_node") for (const id of op.ids || (op.id ? [op.id] : [])) nodes.delete(id);
    }
    return ops;
}

export function isControlReadTool(name: ToolName) {
    return ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "generation_get_status"].includes(name);
}

/** 只向 AI 返回画布字段，不透传任意 metadata、图片数据或全站配置。 */
export function controlSnapshot(state: CanvasSnapshot) {
    return {
        projectId: state.projectId, title: state.title, connections: state.connections || [],
        selectedNodeIds: state.selectedNodeIds || [], viewport: state.viewport,
        format: "structured_canvas", imageContentsIncluded: false,
        nodes: (state.nodes || []).map((node) => {
            const values = Object.fromEntries(Object.entries(node.metadata || {}).filter(([key, value]) => Object.hasOwn(metadata.shape, key) && ["string", "number", "boolean"].includes(typeof value)));
            if (node.type !== "text") delete values.content;
            const truncatedFields: string[] = [];
            if (typeof values.content === "string" && values.content.length > 240) {
                values.content = `${values.content.slice(0, 120)}...`;
                truncatedFields.push("metadata.content");
            }
            return { id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata: values, truncatedFields };
        }),
    };
}
