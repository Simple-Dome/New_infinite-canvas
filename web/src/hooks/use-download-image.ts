import { useCallback } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { imageFileExtension } from "@/lib/image-utils";
import { readImageBlob } from "@/services/image-storage";

export function useDownloadImage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    return useCallback(async (image: { storageKey?: string; url?: string; dataUrl?: string; mimeType?: string }, name: string) => {
        try {
            const blob = await readImageBlob(image);
            saveAs(blob, `${name}.${imageFileExtension(blob.type.startsWith("image/") ? blob.type : image.mimeType)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("common.imageReadFailed"));
        }
    }, [message, t]);
}
