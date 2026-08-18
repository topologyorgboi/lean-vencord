/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Which client is running, and which of Discord's two voice engines it got.
 *
 * Discord ships both a native engine and a browser one in the same bundle and picks the native
 * one only where a real DiscordNative.nativeModules can load discord_voice. On the browser
 * engine several methods are empty function bodies, setInputVolume among them, so Discord's own
 * Input Volume slider is wired to nothing and no gain stage exists anywhere on the microphone
 * path. That is why a mic can be quieter than it was on the Discord desktop app with no setting
 * to explain it.
 */

/**
 * Whether a function does anything. Every getter answers on both engines, so asking the store
 * what it is set to cannot tell them apart: the body is the only direct evidence.
 * A stub ends in an empty block, a real implementation ends in its last statement, and a native
 * binding ends in `[native code] }`.
 */
export function isRealImplementation(source: string): boolean {
    return !source.replace(/\s/g, "").endsWith("{}");
}

/**
 * Reads the injected global rather than the user agent, because Vesktop strips its own token
 * out of navigator.userAgent, which then reads as plain Chrome. Only Discord's own app exposes
 * DiscordNative.
 */
export function detectClient(global: typeof globalThis = globalThis): string {
    if ("VesktopNative" in global) return "Vesktop";
    if ("DiscordNative" in global) return "Discord desktop";
    return "Browser";
}

/** null when the engine has not been built yet, so "unknown" is never reported as "browser". */
export function hasNativeAudioEngine(engine: unknown): boolean | null {
    if (engine == null || typeof engine !== "object") return null;
    const fn = (Object.getPrototypeOf(engine) as { setInputVolume?: unknown } | null)?.setInputVolume;
    if (typeof fn !== "function") return null;
    return isRealImplementation(String(fn));
}
