/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { refreshOpts } from "./hooks/headers";
import { applyMicGain } from "./hooks/mic";
import { applyCss, applyFreeze } from "./hooks/perf";
import { PROFILES } from "./lib/spoof";
import { LeanPanel } from "./ui/panel";

// one line each, read by both the panel and the descriptions below
export const NOTES = {
    spoofClient: "Claim another Windows machine. Build number and channel stay real.",
    deviceProfile: "Which machine to claim.",
    stripDebugHeaders: "Drop X-Debug-Options and X-Track.",
    spoofTimezone: "Send the profile timezone, not your city.",
    idlePause: "Stop animations and blur while the window is in the background.",
    freezeLoops: "Hold gradient names still. Around 55% CPU down to 5%.",
    killBlur: "Remove backdrop blur. Popouts stop looking frosted.",
    micGainDb: "Boost the mic, since Windows processing never reaches Chromium. 0 is off."
};

export const MIC_GAIN_MARKERS = [0, 6, 12, 18, 24, 30, 36];

export const PROFILE_OPTIONS = [
    { label: "Random (chosen once, then remembered)", value: "", default: true },
    ...PROFILES.map(p => ({ label: `${p.os} ${p.os_arch} / ${p.system_locale}`, value: p.id }))
];

// hidden from Vencord's list renderer and drawn by LeanPanel, the only way to group them.
// still declared here so storage, defaults, onChange and import/export keep working
export const settings = definePluginSettings({
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
