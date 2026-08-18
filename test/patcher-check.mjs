/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One cold boot: startup timing, Vencord's CPU self-time, and whether every patch
// applied. Exits non-zero on a correctness failure, so it can gate a deploy.
//
// Driven by patcher-check.ps1, which passes the port, launch timestamp and run label.
const PORT = Number(process.argv[2] || 9223);
const t0 = Number(process.argv[3]);
const LABEL = process.argv[4] || "run";

// vesktop's own enumerateDevices patch misses on this build, predates the
// prefilter, so it's the control: anything else is a regression
const KNOWN_WARNINGS = [/enumerateDevices/];

async function tryJson(path) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json(); } catch { return null; }
}

let page = null, tTarget = null;
while (Date.now() - t0 < 120000) {
    const list = await tryJson("/json/list");
    page = list?.find(t => t.type === "page" && /discord\.com/.test(t.url || ""));
    if (page) { tTarget = Date.now(); break; }
    await new Promise(r => setTimeout(r, 60));
}
if (!page) {
    console.error(`${LABEL} FAIL: no renderer target after 120s`);
    process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));

let id = 0;
const pending = new Map();
const warnings = [];
ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method !== "Runtime.consoleAPICalled") return;

    // vencord prefixes every log with a %c format string plus CSS args, so the
    // message lands last: read the head and you only get CSS
    const text = (m.params.args || []).map(a => a.value ?? a.description ?? "")
        .filter(s => !/^(background|color):/.test(s) && s !== "%c Vencord %c %c WebpackPatcher ")
        .join(" ");
    if (/no effect|failed to patch|errored/i.test(text)) warnings.push(text.slice(-200));
});
const call = (method, params = {}) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
});

await call("Runtime.enable");
await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 200 });
await call("Profiler.start");

// usable = guild rail plus a chat surface on screen, first moment you can act
const USABLE = "!!document.querySelector('[class*=\"guilds\"]') && !!document.querySelector('[class*=\"chat\"], [class*=\"privateChannels\"]')";
let tUsable = null;
while (Date.now() - t0 < 120000) {
    const r = await call("Runtime.evaluate", { expression: USABLE, returnByValue: true });
    if (r?.result?.value === true) { tUsable = Date.now(); break; }
    await new Promise(resolve => setTimeout(resolve, 100));
}
const prof = await call("Profiler.stop");
const samples = prof?.profile?.samples ?? [];
const deltas = prof?.profile?.timeDeltas ?? [];

// self-time in one pass. vencord's renderer bundle is one file, so bucketing by url
// splits its cost from discord's boot. url-less bucket splits by function name since
// garbage collection is the only slice patcher allocation could move
const nodes = new Map((prof?.profile?.nodes ?? []).map(n => [n.id, n]));
const vencordFrames = new Map(), byUrl = new Map(), noUrl = new Map();
let vencordUs = 0, totalUs = 0;

const add = (map, key, us) => map.set(key, (map.get(key) || 0) + us);

for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const frame = node.callFrame || {};
    const us = Math.max(0, deltas[i] || 0);
    totalUs += us;

    add(byUrl, (frame.url || "(none)").split("/").pop().slice(0, 40), us);
    if (!frame.url) add(noUrl, frame.functionName || "(anonymous)", us);
    if (/vencorddesktoprenderer/i.test(frame.url || "")) {
        vencordUs += us;
        add(vencordFrames, `${frame.functionName || "(anonymous)"}:${frame.lineNumber}:${frame.columnNumber}`, us);
    }
}

const state = await call("Runtime.evaluate", {
    expression: `JSON.stringify({
        patchesRemaining: (window.Vencord?.Plugins?.patches || []).length,
        enabledPlugins: Object.keys(window.Vencord?.Plugins?.plugins || {}).filter(n => window.Vencord.Plugins.isPluginEnabled?.(n)).length,
        lean: !!window.Vencord?.Plugins?.plugins?.Lean
    })`,
    returnByValue: true
});
ws.close();

const seconds = us => +(us / 1e6).toFixed(2);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([key, us]) => `${seconds(us)}s ${key}`);

const { patchesRemaining, enabledPlugins, lean } = JSON.parse(state?.result?.value ?? "{}");
const newWarnings = warnings.filter(w => !KNOWN_WARNINGS.some(known => known.test(w)));

console.log(JSON.stringify({
    label: LABEL,
    toRenderer_s: +((tTarget - t0) / 1000).toFixed(2),
    toUsable_s: tUsable ? +((tUsable - t0) / 1000).toFixed(2) : null,
    vencordCpu_s: seconds(vencordUs),
    sampledCpu_s: seconds(totalUs),
    patchesRemaining, enabledPlugins, lean,
    newWarnings,
    topVencordFrames: top(vencordFrames, 4),
    topUrls: top(byUrl, 4),
    noUrl: top(noUrl, 5)
}, null, 2));

// a patch still in the array never found its module: how a broken prefilter shows
// up. time to usable is reported but never failed on, too much of it is network
const failures = [];
if (typeof patchesRemaining !== "number") failures.push("could not read the patch list from the client");
else if (patchesRemaining !== 0) failures.push(`${patchesRemaining} patches never applied`);
if (newWarnings.length) failures.push(`${newWarnings.length} unexpected patch warnings`);
if (tUsable === null) failures.push("client never became usable");

if (failures.length) {
    console.error(`\n${LABEL} FAIL: ${failures.join("; ")}`);
    process.exit(1);
}
console.log(`\n${LABEL} PASS: all patches applied, patcher frame ${top(vencordFrames, 1)[0] ?? "not sampled"}`);
