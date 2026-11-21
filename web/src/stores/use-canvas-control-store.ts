import { create } from "zustand";

import type { CanvasControlPermissions } from "@/lib/canvas/canvas-control";

type CanvasControlState = {
    url: string;
    token: string;
    clientId: string;
    sessionId: string;
    grantId: string;
    projectId: string;
    projectTitle: string;
    connected: boolean;
    connecting: boolean;
    panelOpen: boolean;
    error: string;
    permissions: CanvasControlPermissions;
    setControlState: (patch: Partial<Omit<CanvasControlState, "setControlState" | "reset">>) => void;
    reset: () => void;
};

const initialState = { url: "", token: "", clientId: "", sessionId: "", grantId: "", projectId: "", projectTitle: "", connected: false, connecting: false, panelOpen: false, error: "", permissions: { edit: false, generate: false } };

// 控制凭据和授权仅在内存中保留，刷新后必须由 MCP 重新打开并授权。
export const useCanvasControlStore = create<CanvasControlState>((set) => ({
    ...initialState,
    setControlState: (patch) => set(patch),
    reset: () => set(initialState),
}));
