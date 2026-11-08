import { inferMediaRatio, parsePixelSize } from "@/lib/media-size";
import { isChannelModelValue, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export const protocolVideoModels = {
    grok: ["grok-imagine-video-1.5"],
    minimax: ["minimax_h3-480p", "minimax_h3-768p", "minimax_h3-1080p", "minimax_h3-2k", "minimax_h3-4k"],
};
export const minimaxVideoSizes: Record<string, string[]> = {
    "16:9": ["864x480", "1376x768", "1920x1088"],
    "9:16": ["480x864", "768x1376", "1088x1920"],
    "1:1": ["640x640", "1024x1024", "1440x1440"],
    "2:3": ["544x800", "832x1248", "1184x1760"],
    "3:2": ["800x544", "1248x832", "1760x1184"],
    "3:4": ["576x736", "896x1184", "1248x1664"],
    "4:3": ["736x576", "1184x896", "1664x1248"],
    "21:9": ["992x416", "1568x672", "2208x960"],
};
export const minimaxWorkflows = ["text-to-video", "fl2v", "multi-reference", "cf-fl2v", "cf-multi-reference", "cf-mj"];
const grokRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function getVideoProtocol(config: AiConfig) {
    const model = config.model || config.videoModel;
    return isChannelModelValue(model) ? resolveModelRequestConfig(config, model).apiFormat : config.apiFormat;
}

export function protocolVideoSettings(config: AiConfig) {
    const model = config.model || config.videoModel;
    const request = isChannelModelValue(model) ? resolveModelRequestConfig(config, model) : { ...config, model };
    const protocol = request.apiFormat;
    if (protocol !== "grok" && protocol !== "minimax") return null;
    const quality = protocol === "minimax" ? request.model.replace(/^minimax_h3-/, "") : `${config.vquality.replace(/p$/, "")}p`;
    const resolution = protocol === "grok" && !["480p", "720p", "1080p"].includes(quality) ? "480p" : quality;
    const cf = protocol === "minimax" && (resolution === "2k" || resolution === "4k");
    const ratios = protocol === "grok" ? grokRatios : Object.keys(minimaxVideoSizes);
    const inferred = inferMediaRatio(config.size, "16:9");
    const ratio = ratios.includes(inferred) ? inferred : "16:9";
    const workflows = minimaxWorkflows.filter((value) => value.startsWith("cf-") === cf);
    const workflow = workflows.includes(config.videoWorkflow) ? config.videoWorkflow : cf ? "cf-multi-reference" : "text-to-video";
    const duration = Number(config.videoSeconds);
    const seconds = Number.isInteger(duration) && duration >= 1 && duration <= 15 ? duration : protocol === "grok" ? 8 : 6;
    const customSize = parsePixelSize(config.size) && !Object.values(minimaxVideoSizes).some((sizes) => sizes.includes(config.size));
    const size = cf ? resolution.toUpperCase() : customSize ? config.size : minimaxVideoSize(resolution, ratio);
    return { protocol, resolution, cf, ratios, ratio, workflows, workflow, seconds, size };
}

export function minimaxVideoSize(resolution: string, ratio: string) {
    if (resolution === "2k" || resolution === "4k") return resolution.toUpperCase();
    return minimaxVideoSizes[ratio]?.[["480p", "768p", "1080p"].indexOf(resolution)] || "1376x768";
}

export function validateProtocolVideo(config: AiConfig, prompt: string, images: number, videos: number, audios: number) {
    const settings = protocolVideoSettings(config);
    if (!settings) return;
    if (settings.protocol === "grok") {
        if (images > 1 || videos || audios) throw new Error("Grok 仅支持单张首帧图片，不支持尾帧、视频或音频参考，请先调整素材。");
        if (!prompt.trim() && !images) throw new Error("请输入提示词或添加一张首帧图片。");
        return;
    }
    if (!prompt.trim()) throw new Error("MiniMax 视频生成需要提示词。");
    if (images > 9 || videos > 3 || audios > 3) throw new Error("MiniMax 最多支持 9 张图片、3 个视频和 3 个音频参考。");
    if (settings.workflow === "text-to-video" && images + videos + audios) throw new Error("文生视频工作流不支持参考素材，请移除素材或选择其他工作流。");
    if (settings.workflow.endsWith("fl2v") && (images < 1 || images > 2 || videos || audios)) throw new Error("首尾帧工作流需要 1～2 张图片，不支持视频或音频参考。");
}

export function normalizeProtocolVideoConfig(config: AiConfig): AiConfig {
    const settings = protocolVideoSettings(config);
    if (!settings) return config;
    return { ...config, videoSeconds: String(settings.seconds), vquality: settings.resolution.replace(/p$/, ""), size: settings.protocol === "minimax" && !settings.cf ? settings.size : settings.ratio, videoWorkflow: settings.protocol === "minimax" ? settings.workflow : "" };
}
