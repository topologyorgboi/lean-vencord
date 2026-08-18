/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runnable check for the pure logic in spoof.ts.
//   node check.mjs
// Node 23 and above strips TS types natively, so no build step is needed.
import assert from "node:assert/strict";

import { dbToGain, effectiveGain, shouldBoost, wantsAudio } from "./micgain.ts";
import { pickProfile, planTelemetrySweep, PROFILES, rewriteHeader, spoofSuperProps } from "./spoof.ts";
import { detectClient, hasNativeAudioEngine, isRealImplementation } from "./voice.ts";

// windows-only profiles: Sec-CH-UA-Platform leaks the real OS anyway, so a
// cross-OS profile just singles you out. why: spoof.ts
assert.ok(PROFILES.every(p => p.os === "Windows"), "a non-Windows profile contradicts the unspoofable Sec-CH-UA-Platform hint");

const REAL = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: "1.0.9184",
    os_version: "10.0.22631",
    os_arch: "x64",
    app_arch: "x64",
    system_locale: "en-US",
    has_client_mods: true,
    browser_user_agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9184 Chrome/128.0.6613.36 Electron/32.0.0 Safari/537.36",
    browser_version: "32.0.0",
    os_sdk_version: "22631",
    client_build_number: 356789,
    native_build_number: 58291,
    client_event_source: null,
    client_launch_id: "b1e0b1ff-0000-4000-8000-0000deadbeef",
    client_heartbeat_session_id: "0f0f0f0f-0000-4000-8000-0000cafebabe",
    design_id: 0
};
const realB64 = btoa(JSON.stringify(REAL));
const target = PROFILES.find(p => p.id === "win10-x64-de");
const decode = b64 => JSON.parse(atob(b64));

// 1. build numbers and channel are server-checked, so the swap leaves them alone
assert.equal(decode(spoofSuperProps(realB64, target)).client_build_number, REAL.client_build_number);
assert.equal(decode(spoofSuperProps(realB64, target)).native_build_number, REAL.native_build_number);
assert.equal(decode(spoofSuperProps(realB64, target)).release_channel, REAL.release_channel);

// 2. OS identity is what moves, and only within the Windows family
{
    const out = decode(spoofSuperProps(realB64, target));
    assert.equal(out.os, "Windows");
    assert.equal(out.os_version, target.os_version);
    assert.equal(out.os_arch, target.os_arch);
    assert.equal(out.system_locale, target.system_locale);
}

// 3. UA stays self-consistent: real client/Electron versions kept, only the OS
//    token moved
{
    const ua = decode(spoofSuperProps(realB64, target)).browser_user_agent;
    assert.match(ua, /discord\/1\.0\.9184/);
    assert.match(ua, /Electron\/32\.0\.0/);
    assert.match(ua, /Chrome\/128\.0\.6613\.36/);
    assert.match(ua, new RegExp(target.uaOs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

// 4. launch-correlation fields overwritten in place: every real client sends all
//    three, so missing keys shout louder than odd ones. launch_signature is in
//    the set because it is the client-mod detector.
{
    const UUID = "11111111-2222-4333-8444-555555555555";
    const withSig = { ...REAL, launch_signature: "aaaaaaaa-0000-4000-8000-000000000000" };
    const out = decode(spoofSuperProps(btoa(JSON.stringify(withSig)), target, UUID));
    assert.equal(out.client_launch_id, UUID);
    assert.equal(out.client_heartbeat_session_id, UUID);
    assert.equal(out.launch_signature, UUID);
    assert.notEqual(out.client_launch_id, REAL.client_launch_id);
}

// 5. junk input never breaks a request
assert.equal(spoofSuperProps("not base64 at all!!", target), "not base64 at all!!");
assert.equal(spoofSuperProps(btoa("[1,2,3]"), target), btoa("[1,2,3]"));

// 5b. encoding fails closed too: see the catch in spoofSuperProps
{
    const nonAscii = { ...target, os: "Wíndows", system_locale: "ja-日本" };
    assert.equal(spoofSuperProps(realB64, nonAscii), realB64);
}

// 6. a pinned id stays put across calls: that stability is the whole point
assert.equal(pickProfile("win10-x64-de", () => 0.99).id, "win10-x64-de");
assert.equal(pickProfile("nope", () => 0).id, PROFILES[0].id);
assert.equal(pickProfile("", () => 0.999999).id, PROFILES.at(-1).id);

// 7. debug/tracking headers dropped, case-insensitively
const opts = { profile: target, stripDebug: true, spoofTimezone: true };
for (const h of ["X-Debug-Options", "x-track", "x-DEBUG-options"])
    assert.equal(rewriteHeader(h, "whatever", opts), null, h);

// 7b. X-Fingerprint must survive: it binds register, login and captcha to one
//     session. drop it and you get a failed signup or a captcha loop nobody
//     traces back to a header-stripping plugin.
assert.equal(rewriteHeader("X-Fingerprint", "1234.abcd", opts), "1234.abcd");

// 8. auth/content headers untouched: rewriting these breaks the client
for (const [h, v] of [["Authorization", "tok"], ["Content-Type", "application/json"], ["X-Discord-MFA-Authorization", "tok"]])
    assert.equal(rewriteHeader(h, v, opts), v, h);

// 9. timezone leaks your city: pin it to the profile
assert.equal(rewriteHeader("X-Discord-Timezone", "America/New_York", opts), target.timezone);
assert.equal(rewriteHeader("x-discord-locale", "en-GB", opts), target.system_locale);

// 10. all toggles off, every header passes through verbatim
{
    const off = { profile: null, stripDebug: false, spoofTimezone: false };
    for (const [h, v] of [["X-Super-Properties", realB64], ["X-Debug-Options", "x"], ["X-Discord-Timezone", "Europe/Berlin"]])
        assert.equal(rewriteHeader(h, v, off), v, h);
}

// 11. profile list sanity: unique ids, every field the spoof reads present
{
    assert.equal(new Set(PROFILES.map(p => p.id)).size, PROFILES.length);
    for (const p of PROFILES)
        for (const k of ["id", "os", "os_version", "os_arch", "app_arch", "uaOs", "system_locale", "timezone"])
            assert.ok(p[k], `${p.id} missing ${k}`);
}

// 12. sweep touches only what is on, reports the rest as already off, and never
//     claims to reach what it structurally cannot
{
    const allSafe = planTelemetrySweep({
        noTrackDisableAnalytics: true,
        spoofClient: true, stripDebugHeaders: true, spoofTimezone: true
    });
    assert.equal(allSafe.changed.length, 0, "nothing to change when everything is already safe");
    assert.equal(allSafe.alreadyOff.length, 4);
    assert.ok(allSafe.outOfReach.length > 0, "must always disclose what it cannot touch");

    const allExposed = planTelemetrySweep({
        noTrackDisableAnalytics: false,
        spoofClient: false, stripDebugHeaders: false, spoofTimezone: false
    });
    assert.equal(allExposed.changed.length, 4);
    assert.equal(allExposed.alreadyOff.length, 0);

    // never silently kill another plugin's third-party calls: that is a
    // functionality change, not a telemetry fix
    assert.ok(allSafe.outOfReach.some(s => /Dearrow/.test(s)));

    // cloud sync never gets swept: disclosed list, not changed
    assert.ok(allSafe.outOfReach.some(s => /cloud settings sync/i.test(s)));
    assert.ok(!allExposed.changed.some(s => /cloud/i.test(s)), "sweep must not disable cloud sync");
}

// voice engine detection
{
    // a detector that always answers "browser" would still make the mic diagnosis look right,
    // so both directions are asserted: stubs must read stubbed AND real bodies must read real
    for (const stub of [
        "setInputVolume(e){}",
        "setInputVolume(e) {  }",
        "setInputVolume(e) {\n}",
        "setAudioMixerOptions(e){}"
    ]) assert.equal(isRealImplementation(stub), false, `stub read as real: ${stub}`);

    for (const real of [
        "setInputVolume(e){this.v=e}",
        "setInputVolume(e) {\n  this.v = e;\n}",
        "function setInputVolume() { [native code] }",
        "setInputVolume(e){if(e){}}" // empty block inside a real body
    ]) assert.equal(isRealImplementation(real), true, `real read as stub: ${real}`);

    // an engine that does not exist yet is unknown, never "browser": reporting the browser
    // engine when nothing was read would tell someone on the desktop app to switch clients
    assert.equal(hasNativeAudioEngine(null), null);
    assert.equal(hasNativeAudioEngine(undefined), null);
    assert.equal(hasNativeAudioEngine({}), null, "an object with no setInputVolume is unknown");

    assert.equal(hasNativeAudioEngine(Object.create({ setInputVolume(e) { } })), false);
    assert.equal(hasNativeAudioEngine(Object.create({ setInputVolume(e) { this.v = e; } })), true);

    // detectClient reads the injected global, since Vesktop's user agent says plain Chrome
    assert.equal(detectClient({ VesktopNative: {}, DiscordNative: {} }), "Vesktop");
    assert.equal(detectClient({ DiscordNative: {} }), "Discord desktop");
    assert.equal(detectClient({}), "Browser");
}

// mic gain. a wrong decibel conversion is invisible in use: it still sounds like "a bit
// louder", just never the amount that was asked for
{
    // 0 dB must be EXACTLY unity. anything else means "off" still colours the signal
    assert.equal(dbToGain(0), 1);
    assert.ok(Math.abs(dbToGain(20) - 10) < 1e-9, "20 dB is ten times the amplitude");
    assert.ok(Math.abs(dbToGain(40) - 100) < 1e-9);
    assert.ok(Math.abs(dbToGain(6) - 1.9952623) < 1e-6, "6 dB is roughly double");
    // the loss actually measured against the same mic read through an ordinary capture
    assert.ok(Math.abs(dbToGain(33) - 44.6683592) < 1e-6);

    // the desktop app puts only screen share and camera through getUserMedia, so boosting
    // there would raise whatever someone is sharing rather than their voice
    assert.equal(shouldBoost(24, "Discord desktop"), false);
    assert.equal(shouldBoost(24, "Vesktop"), true);
    assert.equal(shouldBoost(24, "Browser"), true);
    // 0 must not wrap the stream at all, so the default install adds no audio graph
    assert.equal(shouldBoost(0, "Vesktop"), false);
    assert.equal(shouldBoost(0, "Discord desktop"), false);

    assert.equal(wantsAudio({ audio: true }), true);
    assert.equal(wantsAudio({ audio: { deviceId: "x" } }), true);
    assert.equal(wantsAudio({ video: true }), false, "a camera-only request must pass through");
    assert.equal(wantsAudio({ audio: false, video: true }), false);
    assert.equal(wantsAudio(undefined), false);

    // Discord's Input Volume folded in: the dB setting is the ceiling, the slider trims down
    assert.equal(effectiveGain(0, 100), 1, "0 dB at full volume must be unity");
    assert.equal(effectiveGain(20, 100), dbToGain(20));
    assert.ok(Math.abs(effectiveGain(20, 50) - 5) < 1e-9, "half volume halves the amplitude");
    assert.equal(effectiveGain(20, 0), 0, "volume 0 must be silence, not a floor");
    assert.ok(Math.abs(effectiveGain(0, 25) - 0.25) < 1e-9);

    // the value comes from a store rather than the control, so it is bounded, not trusted:
    // an unbounded multiplier on a microphone is heard once and never forgiven
    assert.equal(effectiveGain(0, -50), 0, "a negative volume must not invert the signal");
    assert.equal(effectiveGain(0, 1e9), 2, "an absurd volume is clamped, not honoured");
    assert.equal(effectiveGain(0, NaN), 1, "an unreadable volume means no attenuation");
    assert.equal(effectiveGain(0, Infinity), 1, "a non-finite volume means no attenuation");
}

console.log(`ok - ${PROFILES.length} profiles, all checks passed`);
