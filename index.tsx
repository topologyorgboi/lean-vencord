/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Lean. Two halves, each piece switchable:
 *   1. OPSEC: rewrites or withholds identifying headers Discord gives no setting for.
 *   2. Performance: renderer-side wins no checkbox already covers.
 *
 * Duplicates nothing in NoTrack, SilentTyping, or the Vesktop and Discord settings for
 * hardware acceleration, spellcheck, reduced motion, GIF autoplay and game detection.
 */

import "./styles.css";

import { definePluginSettings, Settings } from "@api/Settings";
import { Switch } from "@components/Switch";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, Select, showToast, Toasts } from "@webpack/common";

import { pickProfile, planTelemetrySweep, PROFILES, rewriteHeader, type RewriteOpts } from "./spoof";
import { detectClient, hasNativeAudioEngine } from "./voice";

const logger = new Logger("Lean");

const MediaEngineStore = findByPropsLazy("getNoiseSuppression", "getEchoCancellation");

// the store is a lazy proxy and the engine is built on demand, so both can throw before a
// voice channel has ever been opened. an unreadable engine is "unknown", never "browser".
function readAudioEngine(): boolean | null {
    try {
        return hasNativeAudioEngine(MediaEngineStore?.getMediaEngine?.());
    } catch {
        return null;
    }
}

// last row of the security section: it is an action over those same toggles, not a
// separate feature, so it belongs with them rather than above the whole panel
function SweepButton() {
    return (
        <div className="vc-lean-row vc-lean-sweep">
            <Button
                color={Button.Colors.RED}
                onClick={() => {
                    const s = settings.store;
                    const plan = planTelemetrySweep({
                        noTrackDisableAnalytics: !!Settings.plugins?.NoTrack?.disableAnalytics,
                        spoofClient: s.spoofClient,
                        stripDebugHeaders: s.stripDebugHeaders,
                        spoofTimezone: s.spoofTimezone
                    });

                    // cloud sync stays on, you use it
                    if (Settings.plugins?.NoTrack) Settings.plugins.NoTrack.disableAnalytics = true;
                    s.spoofClient = true;
                    s.stripDebugHeaders = true;
                    s.spoofTimezone = true;

                    // "changed", not "turned off": analytics goes off, spoofing goes on,
                    // one prefix covers both directions
                    showToast(
                        plan.changed.length
                            ? `Changed: ${plan.changed.join("; ")}`
                            : "Already at maximum, nothing left to change",
                        Toasts.Type.SUCCESS
                    );
                    logger.info("Telemetry sweep. Out of reach from a renderer plugin:\n"
                        + plan.outOfReach.map(item => "  - " + item).join("\n"));
                }}
            >
                Remove All Telemetry
            </Button>
            <Forms.FormText className="vc-lean-sweep-note">
                Analytics off, every toggle above on. Cloud sync is left alone.
                Anything a renderer plugin can't reach is listed in the console.
            </Forms.FormText>
        </div>
    );
}

function Row({ name, note, control, stacked }: {
    name: string; note: string; control: React.ReactNode; stacked?: boolean;
}) {
    return (
        <div className={stacked ? "vc-lean-row vc-lean-row-stacked" : "vc-lean-row"}>
            <div className="vc-lean-row-text">
                <div className="vc-lean-row-name">{name}</div>
                <div className="vc-lean-row-note">{note}</div>
            </div>
            <div className="vc-lean-row-control">{control}</div>
        </div>
    );
}

// open by default: a collapsed panel hides whether anything is on, and the count in the
// summary is only useful once you have closed it yourself
function Section({ title, on, total, children }: React.PropsWithChildren<{
    title: string; on?: number; total?: number;
}>) {
    return (
        <details className="vc-lean-section" open>
            <summary className="vc-lean-summary">
                <span className="vc-lean-summary-title">{title}</span>
                {total != null && <span className="vc-lean-summary-count">{on} of {total} on</span>}
            </summary>
            <div className="vc-lean-body">{children}</div>
        </details>
    );
}

function LeanPanel() {
    const s = settings.use([
        "spoofClient", "deviceProfile", "stripDebugHeaders",
        "spoofTimezone", "idlePause", "freezeLoops", "killBlur"
    ]);

    const headersOn = [s.spoofClient, s.stripDebugHeaders, s.spoofTimezone].filter(Boolean).length;
    const perfOn = [s.idlePause, s.freezeLoops, s.killBlur].filter(Boolean).length;
    const nativeAudio = String(readAudioEngine());

    return (
        <div className="vc-lean-panel">
            <Section title="Security" on={headersOn} total={3}>
                <Row
                    name="Spoof client"
                    note="Claim a different machine in X-Super-Properties. Build number and channel stay real."
                    control={<Switch checked={s.spoofClient} onChange={v => (s.spoofClient = v)} />}
                />
                <Row
                    stacked
                    name="Device profile"
                    note="Which machine to claim. Random picks one and keeps it, since a machine that changes every launch stands out."
                    control={
                        <Select
                            options={PROFILE_OPTIONS}
                            placeholder="Select a profile"
                            maxVisibleItems={5}
                            closeOnSelect={true}
                            isDisabled={!s.spoofClient}
                            select={(v: string) => (s.deviceProfile = v)}
                            isSelected={(v: string) => v === s.deviceProfile}
                            serialize={(v: string) => String(v)}
                        />
                    }
                />
                <Row
                    name="Strip debug headers"
                    note="Drop X-Debug-Options and X-Track."
                    control={<Switch checked={s.stripDebugHeaders} onChange={v => (s.stripDebugHeaders = v)} />}
                />
                <Row
                    name="Spoof timezone"
                    note="Replace X-Discord-Timezone, which otherwise gives away your city."
                    control={<Switch checked={s.spoofTimezone} onChange={v => (s.spoofTimezone = v)} />}
                />
                <SweepButton />
            </Section>

            <Section title="Performance" on={perfOn} total={3}>
                <Row
                    name="Idle pause"
                    note="Freeze animations, transitions and blur while the window is in the background. Nothing changes while you're looking at it."
                    control={<Switch checked={s.idlePause} onChange={v => (s.idlePause = v)} />}
                />
                <Row
                    name="Freeze gradient names"
                    note="Hold looping CSS animations still. Measured 55% CPU against 5% on an idle window. Avatar decorations and nameplates are animated images, not animations, so they keep moving: Discord's Reduced Motion setting is what stops those."
                    control={<Switch checked={s.freezeLoops} onChange={v => (s.freezeLoops = v)} />}
                />
                <Row
                    name="Kill blur"
                    note="Remove every backdrop blur. Big GPU saving, but popouts stop looking frosted."
                    control={<Switch checked={s.killBlur} onChange={v => (s.killBlur = v)} />}
                />
            </Section>

            <Section title="Voice">
                <Row
                    name="Client"
                    note="Which app is running this. Read from the global the client injects, since Vesktop reports itself as plain Chrome in the user agent."
                    control={<span className="vc-lean-verdict">{detectClient()}</span>}
                />
                <Row
                    name="Voice engine"
                    note={VOICE_ENGINE_NOTE[nativeAudio]}
                    control={<span className="vc-lean-verdict">{VOICE_ENGINE_NAME[nativeAudio]}</span>}
                />
            </Section>
        </div>
    );
}

const VOICE_ENGINE_NAME: Record<string, string> = { true: "native", false: "browser", null: "unknown" };

const VOICE_ENGINE_NOTE: Record<string, string> = {
    true: "Discord's native voice engine. The Input Volume slider works.",
    false: "Discord's browser voice engine. Its Input Volume slider is an empty function, so the slider "
        + "does nothing and there is no gain stage on the microphone path at all. Injecting Vencord into "
        + "the Discord desktop app instead gets the native engine, and the slider, back.",
    null: "Could not be read. Discord builds the engine lazily, so open voice settings once and reopen this."
};

const PROFILE_OPTIONS = [
    { label: "Random (chosen once, then remembered)", value: "", default: true },
    ...PROFILES.map(p => ({ label: `${p.os} ${p.os_arch} / ${p.system_locale}`, value: p.id }))
];

// every option is hidden from Vencord's own list renderer and drawn by LeanPanel instead,
// which is the only way to group them. they stay declared here so storage, defaults,
// onChange and settings import/export all keep working
const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: LeanPanel
    },
    spoofClient: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: "Claim a different machine in X-Super-Properties. Build number and channel stay real.",
        onChange: refreshOpts
    },
    deviceProfile: {
        type: OptionType.SELECT,
        hidden: true,
        description: "Which machine to claim. Random picks one and keeps it, since a machine that changes every launch stands out.",
        options: PROFILE_OPTIONS,
        onChange: refreshOpts
    },
    stripDebugHeaders: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: "Drop X-Debug-Options and X-Track.",
        onChange: refreshOpts
    },
    spoofTimezone: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: "Replace X-Discord-Timezone, which otherwise gives away your city.",
        onChange: refreshOpts
    },
    idlePause: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: "Freeze animations, transitions and blur while the window is in the background. Nothing changes while you're looking at it.",
        // this one drives both halves: the stylesheet for transitions and blur, the freeze for loops
        onChange: () => { applyCss(); applyFreeze(); }
    },
    freezeLoops: {
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        description: "Hold looping CSS animations still, gradient usernames above all. Cannot touch avatar decorations, nameplates or animated avatars: those are animated images, which Discord's own Reduced Motion setting covers. Spinners and typing dots keep moving.",
        onChange: applyFreeze
    },
    killBlur: {
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        description: "Remove every backdrop blur. Big GPU saving, but popouts stop looking frosted.",
        onChange: applyCss
    }
});

let started = false;

// rebuilt on settings change, not per header. discord sets 6 to 8 headers a request,
// and walking the settings proxy for each is the exact cost this plugin exists to delete
let currentOpts: RewriteOpts = { profile: null, stripDebug: false, spoofTimezone: false };

function refreshOpts() {
    const s = settings.store;
    currentOpts = {
        profile: s.spoofClient ? pickProfile(s.deviceProfile) : null,
        stripDebug: s.stripDebugHeaders,
        spoofTimezone: s.spoofTimezone
    };
}

// --- request headers ------------------------------------------------------
// hook the two transports instead of patching discord's request module, so nothing here
// depends on a webpack module surviving the next client update

let ourSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;
let ourFetch: typeof window.fetch | null = null;
let prevSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
let prevFetch: typeof window.fetch;

function hookRequests() {
    // captured here, not at module load: another plugin may have wrapped these after us,
    // and restoring a module-load snapshot would silently delete its wrapper. plugins get
    // toggled at runtime, so that ordering is reachable
    prevSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    prevFetch = window.fetch;

    ourSetHeader = function (this: XMLHttpRequest, name: string, value: string) {
        const out = rewriteHeader(name, value, currentOpts);
        if (out === null) return;
        return prevSetHeader.call(this, name, out);
    };

    ourFetch = function (input: any, init?: RequestInit) {
        // read settings before building the Request. new Request() marks its input used,
        // so a throw after it leaves the fallback with a dead body and an unrelated TypeError
        const o = currentOpts;
        let req: Request;
        try {
            req = new Request(input, init);
        } catch {
            return prevFetch.call(window, input, init);
        }
        for (const [name, value] of [...req.headers]) {
            const out = rewriteHeader(name, value, o);
            if (out === null) req.headers.delete(name);
            else if (out !== value) req.headers.set(name, out);
        }
        return prevFetch.call(window, req);
    };

    XMLHttpRequest.prototype.setRequestHeader = ourSetHeader;
    window.fetch = ourFetch;
}

function unhookRequests() {
    // only unwind if nothing wrapped us since, else leave the chain alone rather than
    // clobber another plugin's hook
    if (XMLHttpRequest.prototype.setRequestHeader === ourSetHeader) XMLHttpRequest.prototype.setRequestHeader = prevSetHeader;
    if (window.fetch === ourFetch) window.fetch = prevFetch;
    ourSetHeader = ourFetch = null;
}

// --- renderer performance -------------------------------------------------

const STYLE_ID = "vc-lean-css";

function buildCss(): string {
    const s = settings.store;
    let css = "";

    if (s.idlePause) css += `
        body.vc-lean-idle *,
        body.vc-lean-idle *::before,
        body.vc-lean-idle *::after {
            animation-play-state: paused !important;
            transition-duration: 0s !important;
        }
        body.vc-lean-idle [class*="backdrop"],
        body.vc-lean-idle [class*="layerContainer"] * {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }
    `;

    if (s.killBlur) css += `
        * {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }
    `;

    return css;
}

/*
 * Discord's animated username and avatar cosmetics loop forever, and they are not cheap.
 * Two of them on screen measured 54.8% CPU against 5.1% with animations paused, 1,598 style
 * recalcs in twelve seconds against 64. Nothing else on an idle client came close.
 *
 * Loading spinners and typing dots loop too and have to keep moving, so they are excluded by
 * class rather than frozen with the rest.
 */
// wanderingCubes, chasingDots, pulsingEllipsis and spinningCircle are Discord's own spinner
// variants by name. A frozen spinner reads as a hung client, so they are named explicitly
// rather than left to the generic words.
const KEEP_MOVING = /spinner|spinning|wanderingCubes|chasingDots|pulsingEllipsis|loading|pulse|typing|ellipsis|progress|placeholder|skeleton/i;
const frozen = new Set<Animation>();

function isCosmeticLoop(a: Animation): boolean {
    if (a.playState !== "running") return false;
    if (a.effect?.getTiming().iterations !== Infinity) return false;
    const { target } = a.effect as KeyframeEffect;
    const cls = typeof target?.className === "string" ? target.className : "";
    return !KEEP_MOVING.test(cls);
}

function freezeLoops() {
    for (const a of document.getAnimations()) {
        if (!isCosmeticLoop(a)) continue;
        a.pause();
        frozen.add(a);
    }
}

function thawLoops() {
    for (const a of frozen) {
        // the element can be gone by now, which makes play() throw
        try { a.play(); } catch { /* nothing to resume */ }
    }
    frozen.clear();
}

// frozen outright, or frozen for as long as the window is in the background
const shouldFreeze = () =>
    settings.store.freezeLoops || (settings.store.idlePause && !document.hasFocus());

// animationstart bubbles, so one listener catches every cosmetic Discord adds later without
// polling. a burst of them collapses into a single sweep per frame.
let sweepQueued = false;
const onAnimationStart = () => {
    if (sweepQueued || !started || !shouldFreeze()) return;
    sweepQueued = true;
    requestAnimationFrame(() => {
        sweepQueued = false;
        if (started && shouldFreeze()) freezeLoops();
    });
};

function applyFreeze() {
    if (!started) return;
    if (shouldFreeze()) freezeLoops();
    else thawLoops();
}

function applyCss() {
    // onChange handlers stay registered for disabled plugins. without this guard a toggle
    // re-injects the stylesheet after stop() removed it
    if (!started) return;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = buildCss();
}

/*
 * window blur also fires when focus moves into an embedded iframe, say a youtube or
 * spotify player in chat, where the user is still looking right at us.
 * body can still be null when stop() runs, since start() is now Init-early.
 *
 * The stylesheet alone is not enough. Against a looping cosmetic, `animation-play-state:
 * paused` computes to "paused" on both the element and its ::before, and the animation keeps
 * running anyway: 1,621 style recalcs with the idle class against 1,608 without it. Calling
 * pause() on the animation itself does stop it, so blur freezes loops the same way the
 * Performance toggle does. The CSS stays for transitions and blur, which it does handle.
 */
const onBlur = () => {
    if (document.hasFocus()) return;
    document.body?.classList.add("vc-lean-idle");
    if (settings.store.idlePause) freezeLoops();
};
const onFocus = () => {
    document.body?.classList.remove("vc-lean-idle");
    // leave them frozen if the user asked for that outright
    if (!settings.store.freezeLoops) thawLoops();
};

// the header hook runs at StartAt.Init, which can be before document.head and
// document.body exist, so everything touching the DOM waits for the document
function startDomWork() {
    if (!started) return;
    applyCss();
    onBlur();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("animationstart", onAnimationStart, true);
    applyFreeze();
}

export default definePlugin({
    name: "Lean",
    description: "Strips identifying request headers Discord gives you no setting for, and cuts renderer overhead.",
    authors: [{ name: "betabuxx", id: 1416268961162596364n }],
    settings,

    // drives the github icon in the modal header. needs plugin-modal-source-link.patch,
    // since stock Vencord only builds that link for its own bundled plugins
    sourceUrl: "https://github.com/topologyorgboi/lean-vencord",

    // as early as Vencord allows. the default is WebpackReady, and on a warm boot
    // Discord can get an API request out before that, which goes unspoofed
    startAt: StartAt.Init,

    start() {
        // persist the random pick so the claimed machine stays the same one
        if (!settings.store.deviceProfile)
            settings.store.deviceProfile = pickProfile("").id;

        started = true;
        refreshOpts();
        hookRequests();

        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startDomWork, { once: true });
        else startDomWork();
    },

    stop() {
        started = false;
        unhookRequests();
        document.removeEventListener("DOMContentLoaded", startDomWork);
        document.getElementById(STYLE_ID)?.remove();
        onFocus();
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("animationstart", onAnimationStart, true);
        thawLoops();
    }
});

/*
 * Known limits. This only covers REST headers.
 *
 * The gateway IDENTIFY payload sends its own os/browser/device over the WebSocket in ETF,
 * so Settings > Devices still shows the real machine. Patching the module that builds
 * super-properties would cover both at once, which is where this should go next.
 *
 * User-Agent and Sec-CH-UA-* are forbidden headers, so the claimed OS always rides next to
 * a real Chromium UA. Keep profiles on the host OS until that is fixed.
 */
