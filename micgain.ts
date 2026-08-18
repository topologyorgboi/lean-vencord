/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Mic gain for the browser voice engine, which has none.
 *
 * Chromium takes the capture stream unprocessed, so system effect APOs never apply to it.
 * Measured 33 dB below the same mic through an ordinary capture. Toggling Chromium's own
 * echo cancellation, noise suppression and AGC moved that by under 3 dB, so the constraints
 * are not the lever.
 */

/** 0 dB is exactly unity, so 0 means off. */
export function dbToGain(db: number): number {
    return Math.pow(10, db / 20);
}

/** The native engine routes only screen share and camera through getUserMedia. */
export function shouldBoost(db: number, client: string): boolean {
    return db > 0 && client !== "Discord desktop";
}

export function wantsAudio(constraints?: MediaStreamConstraints): boolean {
    return !!constraints && !!constraints.audio;
}

/**
 * Discord's Input Volume folded in: db is the ceiling, the slider trims from it. Its own
 * setter is a stub, so this is what makes that slider do anything. The value comes from a
 * store rather than the control, so clamp it.
 */
export function effectiveGain(db: number, volumePercent: number): number {
    const v = Number.isFinite(volumePercent) ? Math.min(200, Math.max(0, volumePercent)) : 100;
    return dbToGain(db) * (v / 100);
}
