/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The settings panel. Vencord's list renderer cannot group settings, so every one of them is
 * hidden from it and drawn here instead.
 */

import "./styles.css";

import { Switch } from "@components/Switch";
import { Select, Slider } from "@webpack/common";

import { readAudioEngine } from "../hooks/mic";
import { detectClient } from "../lib/voice";
import { MIC_GAIN_MARKERS, NOTES, PROFILE_OPTIONS, settings } from "../settings";

const ENGINE: Record<string, string> = {
    true: "native engine, its own input volume works",
    false: "browser engine, no input gain of its own",
    null: "engine not built yet, open voice settings once"
};

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

export function LeanPanel() {
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
                {/* one line instead of a row each: neither is a setting, they only say
                    whether the slider below does anything */}
                <div className="vc-lean-status">{detectClient()}: {ENGINE[nativeAudio]}.</div>
                <Row
                    stacked
                    name="Mic gain"
                    note={NOTES.micGainDb}
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
