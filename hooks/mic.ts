/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The gain stage. getUserMedia is wrapped before Discord sees the track, which is the only
 * point on the input path where the level can still change. Why it has to exist: lib/micgain.ts
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";

import { effectiveGain, shouldBoost, wantsAudio } from "../lib/micgain";
import { detectClient, hasNativeAudioEngine } from "../lib/voice";
import { settings } from "../settings";

const logger = new Logger("Lean");

const MediaEngineStore = findByPropsLazy("getNoiseSuppression", "getEchoCancellation");

let ourGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
let prevGetUserMedia: typeof navigator.mediaDevices.getUserMedia;
const liveGains = new Set<GainNode>();
let volumeListening = false;

// lazy proxy, engine built on demand: both throw before any voice UI opens.
// unreadable means unknown, never browser
export function readAudioEngine(): boolean | null {
    try {
        return hasNativeAudioEngine(MediaEngineStore?.getMediaEngine?.());
    } catch {
        return null;
    }
}

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

export function applyMicGain() {
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

export function hookMic() {
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

export function unhookMic() {
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia === ourGetUserMedia) md.getUserMedia = prevGetUserMedia;
    ourGetUserMedia = null;
    liveGains.clear();
    if (volumeListening) {
        try { MediaEngineStore.removeChangeListener(applyMicGain); } catch { /* store never resolved */ }
        volumeListening = false;
    }
}
