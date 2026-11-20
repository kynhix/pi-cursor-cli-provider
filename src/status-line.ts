import type { CursorTurnUsage } from "./cursor-process.js";
import { latestRoutedModel } from "./cursor-process.js";

/** Session entry written once per Cursor CLI process. Not sent to the model. */
export const CURSOR_TURN_STATS_TYPE = "cursor-cli-turn-stats";

export interface CursorTurnStats {
    /** Cache read tokens (hits). */
    cacheRead: number;
    /** Uncached prompt tokens (misses). */
    cacheMiss: number;
    cacheWrite: number;
    output: number;
    /** Display name Cursor Auto selected for this process, when it announced one. */
    routedModel?: string;
}

export function statsFromUsage(usage: CursorTurnUsage | undefined, routedModel: string | undefined): CursorTurnStats | undefined {
    if (!usage && !routedModel) return undefined;
    return {
        cacheRead: usage?.cacheRead ?? 0,
        cacheMiss: usage?.input ?? 0,
        cacheWrite: usage?.cacheWrite ?? 0,
        output: usage?.output ?? 0,
        ...(routedModel ? { routedModel } : {}),
    };
}

interface StatusMessage {
    role?: string;
    provider?: string;
    api?: string;
    content?: unknown;
    usage?: {
        input?: number;
        cacheRead?: number;
    };
}

interface StatusEntry {
    type?: string;
    customType?: string;
    data?: unknown;
    message?: StatusMessage;
}

export interface CacheStatus {
    hits: number;
    misses: number;
    routedModel?: string;
}

function tokenCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function assistantText(message: StatusMessage | undefined): string {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter((block): block is { type: string; text?: string } => !!block && typeof block === "object")
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
}

function isCursorMessage(message: StatusMessage): boolean {
    return message.provider === "cursor" || message.api === "cursor-cli";
}

/**
 * Session cache totals. Cursor messages contribute only recorded CLI usage;
 * their estimated token counts are not cache hits or misses.
 */
export function collectCacheStatus(entries: readonly unknown[], extraText = ""): CacheStatus {
    let hits = 0;
    let misses = 0;
    let routedModel: string | undefined;

    for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as StatusEntry;
        if (entry.type === "custom" && entry.customType === CURSOR_TURN_STATS_TYPE) {
            const data = entry.data as Partial<CursorTurnStats> | undefined;
            hits += tokenCount(data?.cacheRead);
            misses += tokenCount(data?.cacheMiss);
            if (typeof data?.routedModel === "string" && data.routedModel.trim()) {
                routedModel = data.routedModel.trim();
            }
            continue;
        }
        if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
        const message = entry.message;
        if (!isCursorMessage(message) && message.usage) {
            hits += tokenCount(message.usage.cacheRead);
            misses += tokenCount(message.usage.input);
        }
        const routed = latestRoutedModel(assistantText(message));
        if (routed) routedModel = routed;
    }

    const extraRouted = latestRoutedModel(extraText);
    if (extraRouted) routedModel = extraRouted;
    return { hits, misses, routedModel };
}

export function isAutoModel(modelId: string | undefined): boolean {
    if (!modelId) return false;
    return modelId === "auto" || modelId.startsWith("auto-");
}

export function formatTokens(count: number): string {
    const abs = Math.abs(count);
    const sign = count < 0 ? "-" : "";
    if (abs < 1000) return `${sign}${abs}`;
    if (abs < 10000) return `${sign}${(abs / 1000).toFixed(1)}k`;
    if (abs < 1_000_000) return `${sign}${Math.round(abs / 1000)}k`;
    if (abs < 10_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
    return `${sign}${Math.round(abs / 1_000_000)}M`;
}

/** Session cache hits and misses for the right side of the stats line. */
export function formatCacheStatus(stats: CacheStatus): string {
    return `hits ${formatTokens(stats.hits)}  misses ${formatTokens(stats.misses)}`;
}

/** Model Auto last chose. Empty unless the selected model is Auto and a route is known. */
export function autoRoutedModel(stats: CacheStatus, modelId: string | undefined): string {
    if (!isAutoModel(modelId) || !stats.routedModel) return "";
    return stats.routedModel;
}
