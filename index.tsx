/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Lean: header spoofing, renderer performance, and the mic gain stage Discord's browser
 * voice engine lacks. Every piece switchable. Duplicates nothing in NoTrack or SilentTyping.
 */

import "./styles.css";

import { definePluginSettings, Settings } from "@api/Settings";
import { Switch } from "@components/Switch";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, Select, showToast, Slider, Toasts } from "@webpack/common";

import { effectiveGain, shouldBoost, wantsAudio } from "./micgain";
import { pickProfile, planTelemetrySweep, PROFILES, rewriteHeader, type RewriteOpts } from "./spoof";
import { detectClient, hasNativeAudioEngine } from "./voice";

const logger = new Logger("Lean");

const MediaEngineStore = findByPropsLazy("getNoiseSuppression", "getEchoCancellation");

// lazy proxy, engine built on demand: both throw before any voice UI opens.
// unreadable means unknown, never browser
function readAudioEngine(): boolean | null {
    try {
        return hasNativeAudioEngine(MediaEngineStore?.getMediaEngine?.());
    } catch {
        return null;
    }
}

// an action over the security toggles, so it sits with them
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

                    // "changed" covers both directions: analytics off, spoofing on
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

// open by default; the count only matters once you collapse it
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
        "spoofTimezone", "idlePause", "freezeLoops", "killBlur", "micGainDb"
    ]);

    const headersOn = [s.spoofClient, s.stripDebugHeaders, s.spoofTimezone].filter(Boolean).length;
    const perfOn = [s.idlePause, s.freezeLoops, s.killBlur].filter(Boolean).length;
    const nativeAudio = String(readAudioEngine());

    return (
        <div className="vc-lean-panel">
            <Section title="Security" on={headersOn} total={3}>
                <Row
                    name="Spoof client"
                    note={NOTES.spoofClient}
                    control={<Switch checked={s.spoofClient} onChange={v => (s.spoofClient = v)} />}
                />
                <Row
                    stacked
                    name="Device profile"
                    note={NOTES.deviceProfile}
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
                    note={NOTES.stripDebugHeaders}
                    control={<Switch checked={s.stripDebugHeaders} onChange={v => (s.stripDebugHeaders = v)} />}
                />
                <Row
                    name="Spoof timezone"
                    note={NOTES.spoofTimezone}
                    control={<Switch checked={s.spoofTimezone} onChange={v => (s.spoofTimezone = v)} />}
                />
                <SweepButton />
            </Section>

            <Section title="Performance" on={perfOn} total={3}>
                <Row
                    name="Idle pause"
                    note={NOTES.idlePause}
                    control={<Switch checked={s.idlePause} onChange={v => (s.idlePause = v)} />}
                />
                <Row
                    name="Freeze gradient names"
                    note={NOTES.freezeLoops}
                    control={<Switch checked={s.freezeLoops} onChange={v => (s.freezeLoops = v)} />}
                />
                <Row
                    name="Kill blur"
                    note={NOTES.killBlur}
                    control={<Switch checked={s.killBlur} onChange={v => (s.killBlur = v)} />}
                />
            </Section>

            <Section title="Voice">
                <Row
                    name="Client"
                    note={NOTES.client}
                    control={<span className="vc-lean-verdict">{detectClient()}</span>}
                />
                <Row
                    name="Voice engine"
                    note={VOICE_ENGINE_NOTE[nativeAudio]}
                    control={<span className="vc-lean-verdict">{VOICE_ENGINE_NAME[nativeAudio]}</span>}
                />
                <Row
                    stacked
                    name="Mic gain"
                    note={MIC_GAIN_NOTE[nativeAudio]}
                    control={
                        <Slider
                            initialValue={s.micGainDb}
                            minValue={0}
                            maxValue={36}
                            markers={MIC_GAIN_MARKERS}
                            stickToMarkers={false}
                            disabled={nativeAudio === "true"}
                            onValueChange={(v: number) => (s.micGainDb = Math.round(v))}
                            onValueRender={(v: number) => `${Math.round(v)} dB`}
                        />
                    }
                />
            </Section>
        </div>
    );
}

const VOICE_ENGINE_NAME: Record<string, string> = { true: "native", false: "browser", null: "unknown" };

const VOICE_ENGINE_NOTE: Record<string, string> = {
    true: "Native engine. Input Volume works.",
    false: "Browser engine. Its setInputVolume is an empty function and the mic path has no gain stage.",
    null: "Not built yet. Open voice settings once, then reopen this."
};

const MIC_GAIN_MARKERS = [0, 6, 12, 18, 24, 30, 36];

const MIC_GAIN_NOTE: Record<string, string> = {
    true: "Not needed. The native engine has its own input volume.",
    false: "Chromium takes the mic unprocessed, so Windows effect chains never reach it: 33 dB of loss "
        + "here. This is the ceiling, and Discord's Input Volume trims down from it. A limiter after "
        + "the gain stops loud syllables clipping.",
    null: "Open voice settings once, then reopen this."
};

// one string per row, read by both the panel and the settings description below
const NOTES = {
    spoofClient: "Claim a different machine in X-Super-Properties. Build number and channel stay real.",
    deviceProfile: "Which machine to claim. Random picks one and keeps it.",
    stripDebugHeaders: "Drop X-Debug-Options and X-Track.",
    spoofTimezone: "Replace X-Discord-Timezone, which otherwise gives away your city.",
    idlePause: "Freeze animations, transitions and blur while the window is in the background.",
    freezeLoops: "Hold looping CSS animations still: 55% CPU against 5% on an idle window. Avatar "
        + "decorations and nameplates are images rather than animations, so Reduced Motion covers those.",
    killBlur: "Remove every backdrop blur. Saves GPU, but popouts stop looking frosted.",
    micGainDb: "Mic gain in dB. 0 passes the stream through untouched.",
    client: "Which app is running this. Read from the injected global, since Vesktop's user agent says plain Chrome."
};

const PROFILE_OPTIONS = [
    { label: "Random (chosen once, then remembered)", value: "", default: true },
    ...PROFILES.map(p => ({ label: `${p.os} ${p.os_arch} / ${p.system_locale}`, value: p.id }))
];

// hidden from Vencord's list renderer and drawn by LeanPanel, the only way to group them.
// still declared here so storage, defaults, onChange and import/export keep working
const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: LeanPanel
    },
    spoofClient: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: NOTES.spoofClient,
        onChange: refreshOpts
    },
    deviceProfile: {
        type: OptionType.SELECT,
        hidden: true,
        description: NOTES.deviceProfile,
        options: PROFILE_OPTIONS,
        onChange: refreshOpts
    },
    stripDebugHeaders: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: NOTES.stripDebugHeaders,
        onChange: refreshOpts
    },
    spoofTimezone: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: NOTES.spoofTimezone,
        onChange: refreshOpts
    },
    idlePause: {
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true,
        description: NOTES.idlePause,
        // drives both halves: stylesheet for transitions and blur, freeze for loops
        onChange: () => { applyCss(); applyFreeze(); }
    },
    freezeLoops: {
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        description: NOTES.freezeLoops,
        onChange: applyFreeze
    },
    killBlur: {
        type: OptionType.BOOLEAN,
        default: false,
        hidden: true,
        description: NOTES.killBlur,
        onChange: applyCss
    },
    micGainDb: {
        type: OptionType.SLIDER,
        default: 0,
        hidden: true,
        markers: MIC_GAIN_MARKERS,
        stickToMarkers: false,
        description: NOTES.micGainDb,
        onChange: applyMicGain
    }
});

let started = false;

// rebuilt on settings change, not per header: discord sets 6-8 headers a request
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
// hook the transports, not discord's request module: no webpack module to survive an update

let ourSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;
let ourFetch: typeof window.fetch | null = null;
let prevSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
let prevFetch: typeof window.fetch;

function hookRequests() {
    // captured here, not at module load: another plugin may have wrapped these since, and
    // restoring an old snapshot would delete its wrapper
    prevSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    prevFetch = window.fetch;

    ourSetHeader = function (this: XMLHttpRequest, name: string, value: string) {
        const out = rewriteHeader(name, value, currentOpts);
        if (out === null) return;
        return prevSetHeader.call(this, name, out);
    };

    ourFetch = function (input: any, init?: RequestInit) {
        // read settings first: new Request() marks its input used, so a throw after it
        // leaves the fallback with a dead body
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
    // only unwind if nothing wrapped us since, else leave another plugin's hook alone
    if (XMLHttpRequest.prototype.setRequestHeader === ourSetHeader) XMLHttpRequest.prototype.setRequestHeader = prevSetHeader;
    if (window.fetch === ourFetch) window.fetch = prevFetch;
    ourSetHeader = ourFetch = null;
}

// --- microphone gain ------------------------------------------------------
// the only point on the input path where the level can change. why: micgain.ts

let ourGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
let prevGetUserMedia: typeof navigator.mediaDevices.getUserMedia;
const liveGains = new Set<GainNode>();
let volumeListening = false;

// unreadable volume means no attenuation, never silence
function readInputVolume(): number {
    try {
        const v = MediaEngineStore?.getInputVolume?.();
        return typeof v === "number" ? v : 100;
    } catch {
        return 100;
    }
}

// nothing else retunes the graph when the slider moves, so listen to the store
function watchInputVolume() {
    if (volumeListening) return;
    try {
        MediaEngineStore.addChangeListener(applyMicGain);
        volumeListening = true;
    } catch {
        // engine not built yet; tried again on the next capture
    }
}

function applyMicGain() {
    const g = effectiveGain(settings.store.micGainDb, readInputVolume());
    // an open mic is not re-acquired on a settings change, so retune in place
    liveGains.forEach(node => { node.gain.value = g; });
}

function boostStream(stream: MediaStream): MediaStream {
    const source = stream.getAudioTracks()[0];
    if (!source) return stream;

    watchInputVolume();

    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = effectiveGain(settings.store.micGainDb, readInputVolume());

    // a limiter, not a compressor: thirty-odd dB clips on any loud syllable
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(stream).connect(gain).connect(limiter).connect(dest);
    liveGains.add(gain);

    const out = dest.stream.getAudioTracks()[0];

    // the caller gets a different track than the device's. stopping it would leave the mic
    // open, and Discord reads the device off getSettings(), so both must reach the real one
    const stopDest = out.stop.bind(out);
    out.stop = () => {
        stopDest();
        stream.getTracks().forEach(t => t.stop());
        liveGains.delete(gain);
        ctx.close();
    };
    out.getSettings = () => source.getSettings();

    return new MediaStream([out, ...stream.getVideoTracks()]);
}

function hookMic() {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;

    // call through rather than replace: Vesktop wraps getUserMedia for screen-share audio
    prevGetUserMedia = md.getUserMedia.bind(md);

    ourGetUserMedia = async (constraints?: MediaStreamConstraints) => {
        const stream = await prevGetUserMedia(constraints);
        if (!wantsAudio(constraints) || !shouldBoost(settings.store.micGainDb, detectClient()))
            return stream;
        try {
            return boostStream(stream);
        } catch (e) {
            // a broken graph must never cost someone their microphone
            logger.error("mic gain failed, passing the stream through untouched", e);
            return stream;
        }
    };

      md.getUserMedia = ourGetUserMedia;
    watchInputVolume();
}

function unhookMic() {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia === ourGetUserMedia) md.getUserMedia = prevGetUserMedia;
    ourGetUserMedia = null;
    liveGains.clear();
    if (volumeListening) {
        try { MediaEngineStore.removeChangeListener(applyMicGain); } catch { /* store never resolved */ }
        volumeListening = false;
    }
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
 * Animated name and avatar cosmetics loop forever and are not cheap: two on screen measured
 * 54.8% CPU against 5.1% paused, and 1,598 style recalcs in twelve seconds against 64.
 *
 * Spinners and typing dots loop too and must keep moving, so they are excluded by class.
 * A frozen spinner reads as a hung client, hence the explicit names.
 */
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

// animationstart bubbles, so one listener catches every cosmetic added later. a burst
// collapses into one sweep per frame
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
    // onChange stays registered for disabled plugins; without this a toggle re-injects
    // the stylesheet after stop() removed it
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
 * blur also fires when focus moves into an embedded iframe, a youtube or spotify player in
 * chat, where the window is still in view. body can be null when stop() runs, since start()
 * is Init-early.
 *
 * CSS alone is not enough: `animation-play-state: paused` computes to "paused" on the element
 * and its ::before while the animation keeps running, 1,621 style recalcs against 1,608.
 * pause() on the animation does stop it. The CSS stays for transitions and blur.
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

// StartAt.Init can be before document.head and body exist, so DOM work waits
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

    // github icon in the modal header. needs plugin-modal-source-link.patch: stock Vencord
    // only builds that link for its own bundled plugins
    sourceUrl: "https://github.com/topologyorgboi/lean-vencord",

    // the default WebpackReady is too late: on a warm boot Discord gets a request out
    // before it, unspoofed
    startAt: StartAt.Init,

    start() {
        // persist the random pick so the claimed machine stays the same one
        if (!settings.store.deviceProfile)
            settings.store.deviceProfile = pickProfile("").id;

        started = true;
        refreshOpts();
        hookRequests();
        hookMic();

        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startDomWork, { once: true });
        else startDomWork();
    },

    stop() {
        started = false;
        unhookRequests();
        unhookMic();
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
 * Limits. REST headers only: the gateway IDENTIFY payload sends its own os/browser/device
 * over the WebSocket in ETF, so Settings > Devices still shows the real machine. Patching
 * the module that builds super-properties would cover both.
 *
 * User-Agent and Sec-CH-UA-* are forbidden headers, so the claimed OS always rides next to
 * a real Chromium UA. Keep profiles on the host OS until that changes.
 */
