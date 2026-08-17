/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Pure client-fingerprint logic for the Lean plugin.
 *
 * Nothing here imports Vencord, so check.mjs can run it under plain Node with no
 * build step.
 */

export interface Profile {
    id: string;
    os: string;
    os_version: string;
    os_arch: string;
    app_arch: string;
    /** Goes inside the user agent's parentheses. */
    uaOs: string;
    system_locale: string;
    timezone: string;
    os_sdk_version?: string;
}

/*
 * Windows only. Sec-CH-UA-Platform is a forbidden header no renderer can touch, and
 * it says "Windows" whatever X-Super-Properties claims. A macOS blob next to a Windows
 * hint is a pairing no real client emits, so cross-OS profiles made this client easier
 * to pick out.
 *
 * Add other platforms only once the rewrite moves to Vesktop's main process, where
 * onBeforeSendHeaders can set the hint too. See the ceiling note in index.tsx.
 */
export const PROFILES: Profile[] = [
    { id: "win11-x64-us", os: "Windows", os_version: "10.0.22631", os_arch: "x64", app_arch: "x64", uaOs: "Windows NT 10.0; Win64; x64", system_locale: "en-US", timezone: "America/Chicago", os_sdk_version: "22631" },
    { id: "win11-x64-gb", os: "Windows", os_version: "10.0.26100", os_arch: "x64", app_arch: "x64", uaOs: "Windows NT 10.0; Win64; x64", system_locale: "en-GB", timezone: "Europe/London", os_sdk_version: "26100" },
    { id: "win10-x64-de", os: "Windows", os_version: "10.0.19045", os_arch: "x64", app_arch: "x64", uaOs: "Windows NT 10.0; Win64; x64", system_locale: "de", timezone: "Europe/Berlin", os_sdk_version: "19045" },
    { id: "win11-x64-fr", os: "Windows", os_version: "10.0.22631", os_arch: "x64", app_arch: "x64", uaOs: "Windows NT 10.0; Win64; x64", system_locale: "fr", timezone: "Europe/Paris", os_sdk_version: "22631" }
];

/**
 * Correlation IDs tying requests back to one launch.
 *
 * launch_signature is a working client-mod detector. A byte-level search of the live
 * libdiscore WASM (hex-decode, then XOR each byte with 0x73, which is why a plaintext
 * grep finds nothing) turns up a marker table naming Vencord, Vesktop, BetterDiscord,
 * Replugged, Moonlight, OpenAsar, Shelter and a dozen more. The WASM scans globalThis
 * for them at call time and bit-encodes the hits into the UUID it returns.
 *
 * NoTrack patches only the separate hasClientMods JS function, not this. Overwriting
 * the value still beats it: the real bits never reach the wire.
 */
const LAUNCH_FIELDS = ["client_launch_id", "client_heartbeat_session_id", "launch_signature"];

/**
 * Headers safe to withhold. X-Fingerprint is not one: it binds register, login and
 * captcha to one session, so dropping it breaks signup instead of hiding anything.
 */
const DROP_HEADERS = new Set(["x-debug-options", "x-track"]);

/** One identity per client session. Every LAUNCH_FIELDS field gets this value. */
export const SESSION_UUID = crypto.randomUUID();

/**
 * Resolve a profile id. Unknown or empty picks at random. Callers must persist what
 * they got: a stable fake device is far less remarkable than a fresh one every launch.
 */
export function pickProfile(id: string | undefined, rand: () => number = Math.random): Profile {
    return PROFILES.find(p => p.id === id) ?? PROFILES[Math.floor(rand() * PROFILES.length)];
}

/**
 * Rewrite a Base64 X-Super-Properties blob to claim a different machine.
 *
 * Only the OS identity moves: build numbers, channel and client version are
 * server-checked, so they stay as Discord set them. Unparseable input comes back
 * untouched.
 */
export function spoofSuperProps(b64: string, profile: Profile, uuid: string = SESSION_UUID): string {
    try {
        const props = JSON.parse(atob(b64));
        if (props === null || typeof props !== "object" || Array.isArray(props)) return b64;

        props.os = profile.os;
        props.os_version = profile.os_version;
        props.os_arch = profile.os_arch;
        props.app_arch = profile.app_arch;
        props.system_locale = profile.system_locale;

        if (profile.os_sdk_version) props.os_sdk_version = profile.os_sdk_version;
        else delete props.os_sdk_version;

        if (typeof props.browser_user_agent === "string")
            props.browser_user_agent = props.browser_user_agent.replace(/\(([^)]*)\)/, `(${profile.uaOs})`);

        // replaced, not deleted — every real client sends these, so a blob missing
        // the keys has a shape nothing legitimate produces
        for (const f of LAUNCH_FIELDS) if (f in props) props[f] = uuid;

        return btoa(JSON.stringify(props));
    } catch {
        // btoa throws above 0xFF and the XHR caller has no try/catch above us, so
        // an escape here kills the whole request
        return b64;
    }
}

/**
 * What "remove all telemetry" actually changes, kept out of the React button so it
 * stays testable without a DOM.
 *
 * The scope is narrow by design: only what is confirmed to cost no Discord
 * functionality. Whatever NoTrack already covers unconditionally (analytics,
 * METRICS_V2, Sentry, mod detection) is reported, not re-applied, since it is a
 * required plugin and always on.
 */
export interface TelemetrySweepResult {
    changed: string[];
    alreadyOff: string[];
    outOfReach: string[];
}

export function planTelemetrySweep(current: {
    noTrackDisableAnalytics: boolean;
    spoofClient: boolean;
    stripDebugHeaders: boolean;
    spoofTimezone: boolean;
}): TelemetrySweepResult {
    const changed: string[] = [];
    const alreadyOff: string[] = [];

    if (!current.noTrackDisableAnalytics) changed.push("NoTrack analytics toggle (takes effect after restart)");
    else alreadyOff.push("Discord analytics ('science')");

    if (!current.spoofClient) changed.push("Lean client spoofing");
    else alreadyOff.push("Lean client spoofing");
    if (!current.stripDebugHeaders) changed.push("Lean debug-header stripping");
    else alreadyOff.push("Lean debug-header stripping");
    if (!current.spoofTimezone) changed.push("Lean timezone spoofing");
    else alreadyOff.push("Lean timezone spoofing");

    return {
        changed,
        alreadyOff,
        outOfReach: [
            "Vencord cloud settings sync: left on at your request. It uploads your plugin config to api.vencord.dev",
            "METRICS_V2, Sentry crash reporting, and client-mod detection: already patched unconditionally by Vencord's required NoTrack plugin, so there is nothing to do here",
            "Electron main-process telemetry (crash reporter) and the local RPC server: they run outside the renderer, where no plugin can reach them",
            "Sec-CH-UA-Platform and the real Chromium User-Agent: forbidden request headers, unsettable from any renderer script",
            "Third-party API calls made by other enabled feature plugins, such as Dearrow, ReverseImageSearch, and ClearURLs: those are features you switched on rather than telemetry, so this button leaves them alone"
        ]
    };
}

export interface RewriteOpts {
    /** null disables client spoofing. */
    profile: Profile | null;
    stripDebug: boolean;
    spoofTimezone: boolean;
}

/** The new value for an outgoing header, or null to drop it. */
export function rewriteHeader(name: string, value: string, opts: RewriteOpts): string | null {
    const key = name.toLowerCase();

    if (opts.stripDebug && DROP_HEADERS.has(key)) return null;
    if (!opts.profile) return value;

    switch (key) {
        case "x-super-properties":
            return spoofSuperProps(value, opts.profile);
        case "x-discord-locale":
            return opts.profile.system_locale;
        case "x-discord-timezone":
            return opts.spoofTimezone ? opts.profile.timezone : value;
        default:
            return value;
    }
}
