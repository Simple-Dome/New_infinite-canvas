import { inferMediaRatio } from "@/lib/media-size";
import { isChannelModelValue, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export const protocolVideoModels = {
    grok: ["grok-imagine-video-1.5"],
};
const grokRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function getVideoProtocol(config: AiConfig) {
    const model = config.model || config.videoModel;
    return isChannelModelValue(model) ? resolveModelRequestConfig(config, model).apiFormat : config.apiFormat;
}

export function protocolVideoSettings(config: AiConfig) {
    const model = config.model || config.videoModel;
    const request = isChannelModelValue(model) ? resolveModelRequestConfig(config, model) : { ...config, model };
    const protocol = request.apiFormat;
    if (protocol !== "grok") return null;
    const quality = `${config.vquality.replace(/p$/, "")}p`;
    const resolution = ["480p", "720p", "1080p"].includes(quality) ? quality : "480p";
    const inferred = inferMediaRatio(config.size, "16:9");
    const ratio = grokRatios.includes(inferred) ? inferred : "16:9";
    const duration = Number(config.videoSeconds);
    const seconds = Number.isInteger(duration) && duration >= 1 && duration <= 15 ? duration : 8;
    return { protocol, resolution, cf: false, ratios: grokRatios, ratio, workflows: [] as string[], workflow: "", seconds, size: ratio };
}

export function validateProtocolVideo(config: AiConfig, prompt: string, images: number, videos: number, audios: number) {
    const settings = protocolVideoSettings(config);
    if (!settings) return;
    if (settings.protocol === "grok") {
        if (images > 1 || videos || audios) throw new Error("Grok 仅支持单张首帧图片，不支持尾帧、视频或音频参考，请先调整素材。");
        if (!prompt.trim() && !images) throw new Error("请输入提示词或添加一张首帧图片。");
        return;
    }
}

export function normalizeProtocolVideoConfig(config: AiConfig): AiConfig {
    const settings = protocolVideoSettings(config);
    if (!settings) return config;
    return { ...config, videoSeconds: String(settings.seconds), vquality: settings.resolution.replace(/p$/, ""), size: settings.ratio, videoWorkflow: "" };
}
