import { create } from "zustand";
import type { UploadedImage } from "@/services/image-storage";

export type ImageSaveTask = {
    sourceUrl: string;
    status: "saving" | "saved" | "error";
    image?: UploadedImage;
    dimensions?: { width: number; height: number };
    error?: string;
};

export const useImageSaveStore = create<{ tasks: Record<string, ImageSaveTask> }>(() => ({ tasks: {} }));

export function updateImageSaveTask(key: string, task: ImageSaveTask) {
    useImageSaveStore.setState((state) => ({ tasks: { ...state.tasks, [key]: { dimensions: state.tasks[key]?.dimensions, ...task } } }));
}

export function recordImageDimensions(key: string | undefined, width: number, height: number) {
    if (!key || !width || !height) return;
    const task = useImageSaveStore.getState().tasks[key];
    if (!task || task.dimensions?.width === width && task.dimensions.height === height) return;
    updateImageSaveTask(key, { ...task, dimensions: { width, height } });
}
