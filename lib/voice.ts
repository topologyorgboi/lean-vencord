/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Which client is running, and which of Discord's two voice engines it got.
 *
 * Both ship in the same bundle; the native one is picked only where DiscordNative can load
 * discord_voice. The browser engine ships setInputVolume and friends as empty bodies, so
 * Discord's Input Volume slider drives nothing and the mic path has no gain stage.
 */

/**
 * Whether a function has a body. Every getter answers on both engines, so the store cannot
 * tell them apart. A stub ends in an empty block; a native binding ends in `[native code] }`.
 */
export function isRealImplementation(source: string): boolean {
    return !source.replace(/\s/g, "").endsWith("{}");
}

/** Vesktop strips its own token from navigator.userAgent, so read the injected global. */
export function detectClient(global: typeof globalThis = globalThis): string {
    if ("VesktopNative" in global) return "Vesktop";
    if ("DiscordNative" in global) return "Discord desktop";
    return "Browser";
}

/** null while the engine is unbuilt, so unknown is never reported as browser. */
export function hasNativeAudioEngine(engine: unknown): boolean | null {
    if (engine == null || typeof engine !== "object") return null;
    const fn = (Object.getPrototypeOf(engine) as { setInputVolume?: unknown } | null)?.setInputVolume;
    if (typeof fn !== "function") return null;
    return isRealImplementation(String(fn));
}
