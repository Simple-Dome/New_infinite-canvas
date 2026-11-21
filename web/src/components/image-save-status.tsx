import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useImageSaveStore } from "@/stores/use-image-save-store";
import { ensureImageSaved } from "@/services/image-storage";

export function ImageSaveStatus({ storageKey, loadFailed = false }: { storageKey?: string; loadFailed?: boolean }) {
    const { t } = useTranslation();
    const task = useImageSaveStore((state) => storageKey ? state.tasks[storageKey] : undefined);
    if (task?.status === "error") return (
        <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10" title={task.error} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
            event.stopPropagation();
            void ensureImageSaved({ storageKey, url: task.sourceUrl }).catch(() => undefined);
        }}>
            <RefreshCw className="size-3" />{t("imageSave.retry")}
        </button>
    );
    if (loadFailed) return <span className="text-xs">{t("imageSave.loadFailed")}</span>;
    return task?.status === "saving" ? <span className="text-xs opacity-70">{t("imageSave.saving")}</span> : null;
}
