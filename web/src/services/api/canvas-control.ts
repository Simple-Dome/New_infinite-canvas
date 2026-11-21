import { useCanvasControlStore } from "@/stores/use-canvas-control-store";

let revision = 0;
export const nextCanvasControlRevision = () => ++revision;

export async function requestCanvasControl<T>(path: string, body?: unknown, connection = useCanvasControlStore.getState(), signal?: AbortSignal): Promise<T> {
    if (!connection.url || !connection.token) throw new Error("画布控制尚未连接");
    const response = await fetch(`${connection.url}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", "x-canvas-control-token": connection.token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "画布控制请求失败");
    return result;
}

export function openCanvasControlEvents(connection = useCanvasControlStore.getState()) {
    const params = new URLSearchParams({ token: connection.token, clientId: connection.clientId });
    return new EventSource(`${connection.url}/events?${params}`);
}
