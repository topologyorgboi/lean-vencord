/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Renderer work: the idle stylesheet, and holding looping animations still.
 *
 * CSS alone cannot do the second one. `animation-play-state: paused` computes to "paused" on
 * the element and its ::before while the animation keeps running, 1,621 style recalcs against
 * 1,608. pause() on the animation does stop it, so the CSS is left to transitions and blur.
 */

import { settings } from "../settings";

const STYLE_ID = "vc-lean-css";

// start() is Init-early, so DOM work waits for a document
let started = false;

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

export function applyFreeze() {
    if (!started) return;
    if (shouldFreeze()) freezeLoops();
    else thawLoops();
}

export function applyCss() {
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

// blur also fires when focus moves into an embedded iframe, a youtube or spotify player in
// chat, where the window is still in view. body can be null this early
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

function startDomWork() {
    if (!started) return;
    applyCss();
    onBlur();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("animationstart", onAnimationStart, true);
    applyFreeze();
}

export function startPerf() {
    started = true;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startDomWork, { once: true });
    else startDomWork();
}

export function stopPerf() {
    started = false;
    document.removeEventListener("DOMContentLoaded", startDomWork);
    document.getElementById(STYLE_ID)?.remove();
    onFocus();
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("animationstart", onAnimationStart, true);
    thawLoops();
}
