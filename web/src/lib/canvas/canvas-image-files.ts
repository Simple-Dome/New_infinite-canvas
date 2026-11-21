import { fitNodeSize } from "./canvas-node-size";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata } from "@/types/canvas";
import type { ImageSaveTask } from "@/stores/use-image-save-store";

// 按稳定文件键更新所有引用；不按节点 id 写回，旧任务不会覆盖后来生成的新图。
export function createImageFileMapper(tasks: Record<string, ImageSaveTask>) {
    const cache = new WeakMap<CanvasNodeData, CanvasNodeData>();
    const arrays = new WeakMap<CanvasNodeData[], CanvasNodeData[]>();
    const metadata = <T extends CanvasNodeMetadata | CanvasNodeImage>(value: T): T => {
        const task = value.storageKey ? tasks[value.storageKey] : undefined;
        const size = task?.image || task?.dimensions;
        const saved = task?.image;
        if (!size || value.naturalWidth === size.width && value.naturalHeight === size.height && (!saved || value.content === saved.url && value.bytes === saved.bytes && value.mimeType === saved.mimeType)) return value;
        return { ...value, naturalWidth: size.width, naturalHeight: size.height, ...(saved ? { content: saved.url, bytes: saved.bytes, mimeType: saved.mimeType } : {}) };
    };
    return (nodes: CanvasNodeData[]) => {
        const cached = arrays.get(nodes);
        if (cached) return cached;
        let changed = false;
        const next = nodes.map((node) => {
            let updated = cache.get(node);
            if (!updated) {
                const original = node.metadata;
                if (!original) return node;
                let value = metadata(original);
                const images = original.images?.map(metadata);
                if (images?.some((image, index) => image !== original.images![index])) value = { ...value, images };
                const size = node.type === CanvasNodeType.Image && !original.naturalWidth && value.naturalWidth && value.naturalHeight && !original.freeResize
                    ? fitNodeSize(value.naturalWidth, value.naturalHeight, node.width, node.height)
                    : null;
                updated = value === original ? node : { ...node, ...(size ? { ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 } } : {}), metadata: value };
                cache.set(node, updated);
            }
            changed ||= updated !== node;
            return updated;
        });
        const result = changed ? next : nodes;
        arrays.set(nodes, result);
        return result;
    };
}
