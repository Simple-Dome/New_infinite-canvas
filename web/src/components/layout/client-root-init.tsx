import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { ApiAccessError } from "@/lib/api-access";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey, activate: true });
        if (result.status === "missing-base-url" || result.status === "invalid-base-url") {
            message.error(new ApiAccessError().message);
            return;
        }
        openConfigDialog(false, "channels");
        message.success(apiKey ? "已导入 API Key" : "已选择对应域名的渠道");
    }, [importChannelCredentials, message, openConfigDialog]);

    return <>{children}</>;
}
