import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { CANVAS_CONTROL_PROTOCOL_VERSION, isCanvasControlProjectOpen, readCanvasControlBootstrap, validateCanvasControlOps, validateCanvasControlUrl, type CanvasControlCall, type CanvasControlPermissions } from "@/lib/canvas/canvas-control";
import { nextCanvasControlRevision, openCanvasControlEvents, requestCanvasControl } from "@/services/api/canvas-control";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasControlStore } from "@/stores/use-canvas-control-store";

const errorText = (error: unknown) => error instanceof Error ? error.message : "画布控制失败";

/** 跨页面只挂载一次；节点变化仅上报快照，不参与 SSE effect 的依赖。 */
export function useCanvasControlConnection() {
    const { hash, pathname } = useLocation();
    const navigate = useNavigate();
    const url = useCanvasControlStore((state) => state.url);
    const token = useCanvasControlStore((state) => state.token);
    const clientId = useCanvasControlStore((state) => state.clientId);

    useLayoutEffect(() => {
        const bootstrap = readCanvasControlBootstrap(hash);
        if (!bootstrap) return;
        navigate(`${window.location.pathname}${window.location.search}${bootstrap.remainingHash}`, { replace: true });
        try {
            if (!bootstrap.token) throw new Error("缺少控制凭据，请通过 MCP 重新打开画布");
            const endpoint = validateCanvasControlUrl(bootstrap.url);
            const existing = useCanvasControlStore.getState();
            if (existing.url === endpoint && existing.token === bootstrap.token) return;
            if (existing.url) throw new Error("已有画布控制会话，请先断开后重新打开");
            useCanvasControlStore.getState().setControlState({ url: endpoint, token: bootstrap.token, clientId: crypto.randomUUID(), connecting: true, panelOpen: true, error: "" });
        } catch (error) {
            useCanvasControlStore.getState().setControlState({ panelOpen: true, error: errorText(error) });
        }
    }, [hash, navigate]);

    useEffect(() => {
        const state = useCanvasControlStore.getState();
        if (state.grantId && !isCanvasControlProjectOpen(state.projectId)) void disconnectCanvasControl();
    }, [pathname]);

    useEffect(() => {
        if (!url || !token || !clientId) return;
        const connection = useCanvasControlStore.getState();
        const abort = new AbortController();
        const source = openCanvasControlEvents(connection);
        let disposed = false;
        let queue = Promise.resolve();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const calls = new Map<string, { cancelled: boolean }>();
        const current = () => !disposed && useCanvasControlStore.getState().clientId === clientId;
        const fail = (error: unknown) => {
            if (!current()) return;
            source.close();
            useCanvasControlStore.getState().setControlState({ connected: false, connecting: false, grantId: "", projectId: "", sessionId: "", error: errorText(error), panelOpen: true });
        };
        source.addEventListener("hello", (event) => {
            if (!current()) return;
            try {
                const data = JSON.parse((event as MessageEvent<string>).data);
                if (data.mode !== "control" || data.protocolVersion !== CANVAS_CONTROL_PROTOCOL_VERSION || data.clientId !== clientId) throw new Error("控制协议不匹配，请更新网页与 MCP 后重新连接");
                useCanvasControlStore.getState().setControlState({ connected: true, connecting: false, sessionId: data.sessionId, grantId: "", projectId: "", error: "" });
            } catch (error) { fail(error); }
        });
        source.addEventListener("tool_cancel", (event) => {
            try {
                const data = JSON.parse((event as MessageEvent<string>).data);
                const call = calls.get(data.requestId);
                if (call) call.cancelled = true;
            } catch { /* 无效取消事件不能触发任何操作。 */ }
        });
        source.addEventListener("tool_call", (event) => {
            if (!current()) return;
            let payload: CanvasControlCall;
            try { payload = JSON.parse((event as MessageEvent<string>).data) as CanvasControlCall; }
            catch (error) { fail(error); return; }
            if (!payload || !payload.requestId || calls.has(payload.requestId)) return;
            const call = { cancelled: false };
            calls.set(payload.requestId, call);
            queue = queue.then(async () => {
                const active = () => {
                    const state = useCanvasControlStore.getState();
                    const context = useAgentStore.getState().canvasContext;
                    if (!current() || call.cancelled || !state.connected || !state.grantId || state.grantId !== payload.grantId || state.projectId !== payload.projectId || !context || context.snapshot.projectId !== payload.projectId || !isCanvasControlProjectOpen(payload.projectId)) throw new Error("请求已取消、授权已撤销或目标画布已切换");
                    return { state, context };
                };
                try {
                    active();
                    const check = new URLSearchParams({ clientId, grantId: payload.grantId, projectId: payload.projectId, requestId: payload.requestId });
                    const { active: pending } = await requestCanvasControl<{ active: boolean }>(`/check?${check}`, undefined, connection, abort.signal);
                    if (!pending) return;
                    const { state, context } = active();
                    let snapshot = context.snapshot;
                    if (payload.name === "canvas_apply_ops") {
                        const ops = validateCanvasControlOps(payload.input?.ops, state.permissions, snapshot);
                        snapshot = context.applyOps(ops);
                        useAgentStore.getState().setCanvasContext({ ...context, snapshot });
                    } else if (!["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "generation_get_status"].includes(payload.name)) {
                        throw new Error("该工具不在画布控制范围内");
                    }
                    await requestCanvasControl(`/result?${new URLSearchParams({ clientId })}`, { requestId: payload.requestId, grantId: payload.grantId, projectId: payload.projectId, snapshot, revision: nextCanvasControlRevision(), result: { applied: payload.name === "canvas_apply_ops" } }, connection, abort.signal);
                } catch (error) {
                    if (!current() || call.cancelled) return;
                    try {
                        await requestCanvasControl(`/result?${new URLSearchParams({ clientId })}`, { requestId: payload.requestId, grantId: payload.grantId, projectId: payload.projectId, error: errorText(error) }, connection, abort.signal);
                    } catch {
                        if (current()) useCanvasControlStore.getState().setControlState({ error: "操作结果无法回传，操作可能已执行；请检查画布，不要重复生成。" });
                    }
                } finally { calls.delete(payload.requestId); }
            }).catch((error) => { if (current()) useCanvasControlStore.getState().setControlState({ error: errorText(error) }); });
        });
        source.onerror = () => fail(new Error("控制连接已断开或浏览器未允许访问本机网络，请检查 MCP 与网站权限后重连；已发送操作的结果需要确认。"));

        const unsubscribe = useAgentStore.subscribe((state, previous) => {
            if (state.canvasContext === previous.canvasContext) return;
            // 画布 effect 更新上下文时会先清空再重新注册，在本轮 effect 完成后读取。
            queueMicrotask(() => {
                if (!current()) return;
                const control = useCanvasControlStore.getState();
                if (!control.grantId) return;
                const snapshot = useAgentStore.getState().canvasContext?.snapshot;
                if (!snapshot || snapshot.projectId !== control.projectId || !isCanvasControlProjectOpen(control.projectId)) {
                    void disconnectCanvasControl();
                    return;
                }
                clearTimeout(timer);
                // 沿用现有 Agent 快照上报的 300ms 防抖。
                timer = setTimeout(() => {
                    const latest = useCanvasControlStore.getState();
                    const next = useAgentStore.getState().canvasContext?.snapshot;
                    if (!current() || !latest.grantId || latest.projectId !== next?.projectId || !isCanvasControlProjectOpen(latest.projectId)) return;
                    const query = new URLSearchParams({ clientId, grantId: latest.grantId });
                    void requestCanvasControl(`/state?${query}`, { snapshot: next, revision: nextCanvasControlRevision() }, connection, abort.signal).catch(fail);
                }, 300);
            });
        });
        return () => {
            disposed = true;
            clearTimeout(timer);
            abort.abort();
            unsubscribe();
            source.close();
            calls.clear();
        };
    }, [url, token, clientId]);
}

/** UI 副作用由 hook 导出，store 仅保存连接与授权状态。 */
export function useCanvasControlActions() {
    return {
        async authorize(permissions: CanvasControlPermissions) {
            const connection = useCanvasControlStore.getState();
            const snapshot = useAgentStore.getState().canvasContext?.snapshot;
            if (!connection.connected || !snapshot || !isCanvasControlProjectOpen(snapshot.projectId)) throw new Error("请先连接 MCP 并打开目标画布");
            const result = await requestCanvasControl<{ grantId: string; projectId: string }>("/authorize", { clientId: connection.clientId, permissions, snapshot, revision: nextCanvasControlRevision() }, connection);
            if (!useCanvasControlStore.getState().connected || useCanvasControlStore.getState().clientId !== connection.clientId || useAgentStore.getState().canvasContext?.snapshot.projectId !== snapshot.projectId || !isCanvasControlProjectOpen(snapshot.projectId)) {
                await requestCanvasControl("/disconnect", { clientId: connection.clientId, grantId: result.grantId }, connection);
                throw new Error("授权期间画布或连接已切换，请重新授权");
            }
            useCanvasControlStore.getState().setControlState({ grantId: result.grantId, projectId: result.projectId, projectTitle: snapshot.title, permissions, panelOpen: false, error: "" });
        },
        disconnect: disconnectCanvasControl,
        reconnect() {
            const state = useCanvasControlStore.getState();
            state.setControlState({ clientId: crypto.randomUUID(), sessionId: "", grantId: "", projectId: "", connected: false, connecting: true, error: "" });
        },
    };
}

async function disconnectCanvasControl() {
    const connection = useCanvasControlStore.getState();
    // 先禁用本地执行，再撤销服务端授权；SSE 关闭同样会撤销授权。
    connection.reset();
    if (connection.grantId) {
        try { await requestCanvasControl("/disconnect", { clientId: connection.clientId, grantId: connection.grantId }, connection); }
        catch { /* 连接关闭也会撤销 Agent 中的授权，已启动生成不会被伪装为取消。 */ }
    }
}
