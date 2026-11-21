import { useEffect, useState } from "react";
import { Button, Checkbox, Modal } from "antd";
import { PlugZap, Unplug } from "lucide-react";

import { useCanvasControlActions } from "@/hooks/use-canvas-control-connection";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasControlStore } from "@/stores/use-canvas-control-store";
import { useThemeStore } from "@/stores/use-theme-store";

/** 控制状态与授权直接读取全局入口，不经过画布页面透传参数。 */
export function CanvasControlStatus() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const url = useCanvasControlStore((state) => state.url);
    const clientId = useCanvasControlStore((state) => state.clientId);
    const connected = useCanvasControlStore((state) => state.connected);
    const connecting = useCanvasControlStore((state) => state.connecting);
    const grantId = useCanvasControlStore((state) => state.grantId);
    const projectTitle = useCanvasControlStore((state) => state.projectTitle);
    const permissions = useCanvasControlStore((state) => state.permissions);
    const panelOpen = useCanvasControlStore((state) => state.panelOpen);
    const error = useCanvasControlStore((state) => state.error);
    const [edit, setEdit] = useState(false);
    const [generate, setGenerate] = useState(false);
    const [busy, setBusy] = useState(false);
    const actions = useCanvasControlActions();
    const setControlState = useCanvasControlStore((state) => state.setControlState);
    useEffect(() => { setEdit(false); setGenerate(false); }, [clientId]);
    if (!url && !error) return null;
    const label = grantId ? "AI 控制已授权" : connected ? "AI 控制待授权" : connecting ? "AI 控制连接中" : "AI 控制已断开";
    const authorize = async () => {
        setBusy(true);
        try { await actions.authorize({ edit, generate: edit && generate }); }
        catch (error) { if (useCanvasControlStore.getState().clientId === clientId) setControlState({ error: error instanceof Error ? error.message : "授权失败" }); }
        finally { setBusy(false); }
    };
    return (
        <>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded px-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: grantId ? theme.node.text : theme.node.muted }} onClick={() => setControlState({ panelOpen: true })} aria-label="管理本地 AI 画布控制">
                <PlugZap className="size-3.5" />
                <span>{label}</span>
            </button>
            <Modal title="本地 AI 画布控制" open={panelOpen} onCancel={() => setControlState({ panelOpen: false })} centered footer={null}>
                <div className="space-y-5 py-2" style={{ color: theme.node.text }}>
                    <div className="space-y-2 text-sm leading-6">
                        <p>{grantId ? `当前授权画布：${projectTitle}` : "连接来自你电脑上运行的 MCP。授权后，AI 可以读取当前画布；你可以另外允许编辑和生成。"}</p>
                        <p style={{ color: theme.node.muted }}>仅控制本次授权的画布。切换画布、刷新页面或断开连接后需要重新授权。</p>
                    </div>
                    {error ? <p role="alert" className="break-words text-sm">{error}</p> : null}
                    {grantId ? (
                        <p className="text-sm" style={{ color: theme.node.muted }}>读取：已允许 · 编辑：{permissions.edit ? "已允许" : "未允许"} · 生成：{permissions.generate ? "已允许" : "未允许"}</p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <Checkbox checked={edit} disabled={busy} onChange={(event) => { setEdit(event.target.checked); if (!event.target.checked) setGenerate(false); }}>允许编辑节点、连线、选区与视口</Checkbox>
                            <Checkbox checked={generate} disabled={!edit || busy} onChange={(event) => setGenerate(event.target.checked)}>允许触发生成，使用网页当前接口配置和 API Key，可能产生费用</Checkbox>
                        </div>
                    )}
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>数据继续保存在浏览器本地。断开控制不会取消已经提交的生成任务，也不代表云端备份。</p>
                    <div className="flex justify-end gap-2">
                        <Button type="text" icon={<Unplug className="size-4" />} onClick={() => void actions.disconnect()}>断开控制</Button>
                        {!grantId && !connected && url ? <Button type="text" disabled={connecting} onClick={actions.reconnect}>重新连接</Button> : null}
                        {!grantId ? <Button type="text" loading={busy} disabled={!connected} onClick={() => void authorize()}>授权当前画布</Button> : null}
                    </div>
                </div>
            </Modal>
        </>
    );
}
