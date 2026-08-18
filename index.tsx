/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Lean: header spoofing, renderer performance, and the mic gain stage Discord's browser
 * voice engine lacks. Every piece switchable. Duplicates nothing in NoTrack or SilentTyping.
 *
 *   settings.ts   the settings and the text on them
 *   hooks/        the three things it actually does
 *   lib/          the pure logic behind them, which test/check.mjs runs
 *   ui/panel.tsx  the settings screen
 */

import definePlugin, { StartAt } from "@utils/types";

import { hookRequests, refreshOpts, unhookRequests } from "./hooks/headers";
import { hookMic, unhookMic } from "./hooks/mic";
import { startPerf, stopPerf } from "./hooks/perf";
import { pickProfile } from "./lib/spoof";
import { settings } from "./settings";

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

        refreshOpts();
        hookRequests();
        hookMic();
        startPerf();
    },

    stop() {
        unhookRequests();
        unhookMic();
        stopPerf();
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
