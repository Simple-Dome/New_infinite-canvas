import assert from "node:assert/strict";
import test from "node:test";

import { controlSnapshot, controlToolNames, validateControlOps } from "./control.js";
import type { CanvasSnapshot } from "./types.js";

const state: CanvasSnapshot = { projectId: "project", nodes: [{ id: "image", type: "image", position: { x: 0, y: 0 }, width: 400, height: 200, metadata: { naturalWidth: 1600, naturalHeight: 800 } }], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

test("编辑授权不能通过批量操作夹带生成，失败不修改原快照", () => {
    const before = structuredClone(state);
    assert.throws(() => validateControlOps([{ type: "add_node", id: "text", nodeType: "text" }, { type: "run_generation", nodeId: "text" }], { edit: true, generate: false }, state), /生成授权/);
    assert.deepEqual(state, before);
    assert.throws(() => validateControlOps([{ type: "delete_node", id: "image" }], { edit: false, generate: false }, state), /编辑授权/);
});

test("整批操作检查引用与节点标识，不能通过 metadata 或 patch 扩大权限", () => {
    const permissions = { edit: true, generate: true };
    assert.throws(() => validateControlOps([{ type: "update_node", id: "image", patch: { id: "other" } }], permissions, state));
    assert.throws(() => validateControlOps([{ type: "update_node", id: "image", metadata: { apiKey: "secret" } }], permissions, state));
    assert.throws(() => validateControlOps([{ type: "connect_nodes", fromNodeId: "missing", toNodeId: "image" }], permissions, state), /不存在/);
    const ops = validateControlOps([{ type: "add_node", id: "text", nodeType: "text" }, { type: "connect_nodes", fromNodeId: "text", toNodeId: "image" }], permissions, state);
    assert.equal(ops.length, 2);
});

test("图片尺寸默认保持原始比例，明确自由变形时才接受任意尺寸", () => {
    const permissions = { edit: true, generate: false };
    const [op] = validateControlOps([{ type: "update_node", id: "image", patch: { width: 600, height: 600 } }], permissions, state);
    assert.equal(op.type, "update_node");
    if (op.type === "update_node") assert.deepEqual(op.patch, { width: 600, height: 300 });
    const [free] = validateControlOps([{ type: "update_node", id: "image", patch: { width: 600, height: 600 }, metadata: { freeResize: true } }], permissions, state);
    if (free.type === "update_node") assert.equal(free.patch?.height, 600);
});

test("对外快照标明文本截断并排除媒体内容和非画布配置", () => {
    const safe = controlSnapshot({ ...state, nodes: [
        { id: "text", type: "text", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "字".repeat(300), apiKey: "secret", privateField: "hidden" } },
        { ...state.nodes![0], metadata: { content: "data:image/png;base64,secret", storageKey: "private", status: "success" } },
    ] });
    assert.deepEqual(safe.nodes[0].truncatedFields, ["metadata.content"]);
    assert.equal(safe.imageContentsIncluded, false);
    assert.equal(JSON.stringify(safe).includes("secret"), false);
    assert.equal(JSON.stringify(safe).includes("hidden"), false);
});

test("控制工具清单不开放全站、内置附件或工作台", () => {
    assert.equal(controlToolNames.includes("canvas_create_attachment_nodes"), false);
    assert.equal(controlToolNames.includes("canvas_list_projects"), false);
    assert.equal(controlToolNames.includes("site_navigate"), false);
    assert.equal(controlToolNames.includes("workbench_image_generate"), false);
});
