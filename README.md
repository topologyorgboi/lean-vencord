# Lean

Vencord userplugin. Strips the identifying headers Discord won't give you a setting for,
adds the mic gain stage the browser voice engine lacks, and ships a patch that cuts
Vencord's startup patching from 1.57s to 0.68s.

## Install

From your Vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/*.patch
pnpm build
```

Skip the `git apply` line if you just want the plugin. The patches only make Vencord boot
faster and put a source link in the plugin's own settings header.

On Vesktop, `pnpm build` isn't enough. Vesktop keeps its own copy of Vencord and ignores
`vencordDir`, so copy the build over yourself:

```powershell
Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
```

Restart, then turn Lean on in Settings > Plugins.

Turn **Vencord > Automatically update** off once you have. The updater replaces those same
files with the official release build, which deletes your plugin, and then reports "Vencord
has been updated!" with nothing in it. Vesktop itself leaves the files alone: its
`ensureVencordFiles` only checks that they exist.

## What it does to your headers

- `X-Super-Properties` is rewritten to claim some other Windows box. Build number and
  release channel are left alone, since the server checks those.
- The three launch IDs are overwritten, `launch_signature` included. That one is an actual
  client-mod detector: libdiscore's WASM digs through `globalThis` for Vencord, Vesktop,
  BetterDiscord and friends, then packs what it finds into the UUID it hands back. The names
  are hex-encoded and XORed with `0x73`, which is why grepping the file turns up nothing.
- `X-Debug-Options` and `X-Track` are dropped.
- `X-Discord-Timezone` and `X-Discord-Locale` are pinned to the profile, so your city stops
  riding along on every request.
- `X-Fingerprint` stays. It ties register, login and captcha to one session, so killing it
  breaks signup instead of hiding you.

Profiles are Windows-only. `Sec-CH-UA-Platform` is a forbidden header, nothing in the
renderer can touch it, and it reports your real OS anyway. Claim macOS and you just end up
looking stranger than everyone else.

The plugin starts at `StartAt.Init`, earlier than plugins normally do, because on a warm boot
Discord can fire its first API call before a normal plugin is running.

## Speed

Three toggles, each measured on a live client rather than assumed.

**Freeze gradient names** is the one that matters. Discord's looping username gradients never
stop and are not cheap: one on screen measured 17.1-19.7% CPU against 2.4-3.4% frozen, and
about 1,620 style recalculations per twelve seconds against 60. Two on screen measured 55%
against 5%. Spinners, typing dots and skeletons are excluded by name, so a frozen one never
reads as a hung client.

It pauses Web Animations, so it cannot touch anything that was never one. Avatar decorations,
nameplates and animated avatars are animated WebP decoded by the image pipeline, and
`document.getAnimations()` never returns them. Discord's Reduced Motion setting stops those.
Freezing animated images was measured anyway at 0.05s per 8s, so there was nothing to win.

CSS cannot do this. `animation-play-state: paused` computes to "paused" on both the element
and its `::before` while the animation keeps running: 1,621 recalculations with the rule
against 1,608 without. Pausing the animation object does work, so that is what both toggles use.

**Idle pause** freezes those same loops, plus transitions and blur, while the window is in the
background. It is worth more on Vesktop than you'd expect, since Vesktop turns Chromium's own
background throttling off.

**Kill blur** removes every backdrop blur. There is usually nothing to remove until a popout or
modal opens, which is where Discord's blur lives.

Measured and dropped, so you know what isn't here: turning off spellcheck (7.9s against 7.6s to
type 320 characters, inside the noise), `content-visibility` on message rows (Discord already
virtualises the list), and freezing animated images (0.05s per 8s).

## Voice

Discord ships two voice engines in the same bundle and uses the native one only where a real
`DiscordNative.nativeModules` can load `discord_voice`. Vesktop loads the web client, so it gets
the browser engine, where `setInputVolume` is an empty function body:

```js
setInputVolume(e){}
```

Discord's **Input Volume slider does nothing there**, and there is nothing else to turn up:
every gain node in the graph belongs to a remote user. `bypassSystemInputProcessing` is stored
and applied by nothing for the same reason. The plugin reads the function body rather than
asking the store, since every getter answers on both engines.

The client row reads the global the app injects rather than the user agent, since Vesktop
reports itself as plain Chrome.

### Mic gain

Chromium asks Windows for the *unprocessed* capture stream so its own echo canceller gets clean
input, which also skips every system effect on that device. If your mic's level comes from a
system effect chain, an Equalizer APO preamp or a vendor DSP, none of it arrives. Measured at
**33.1 dB** below the same mic read through an ordinary capture over the same ten seconds, RMS
and peak gaps agreeing to 0.1 dB: pure gain loss, not tone or dynamics.

No Discord or Windows setting recovers it. Toggling Chromium's own echo cancellation, noise
suppression and gain control moved that gap by under 3 dB. It takes the raw stream either way.

So the slider adds gain in the renderer, after `getUserMedia` and before Discord sees the track,
with a limiter behind it so loud syllables clip instead of the gain being spent on headroom. At
0 dB the stream passes through untouched and no audio graph is built. It does nothing on the
desktop app, which routes only screen share and camera through `getUserMedia`.

Since that gain node is the only thing on the input path, **Discord's own Input Volume slider is
wired to it**, which is what makes that slider work on this engine at all. The dB setting is the
ceiling and the slider trims down from it. The store value is clamped rather than trusted.

Verified by opening a wrapped and an unwrapped capture of the same mic at the same instant:
asked 24 dB, measured 25.69 dB RMS and 25.71 dB peak. The extra 1.7 dB is
`DynamicsCompressorNode`'s own gain, measured separately at +1.71 dB and constant at every input
level. The same paired trick, with the unwrapped stream as a control the slider cannot reach,
puts a half-volume move at -6.44 dB against -6.02 expected.

Measure it that way or not at all. Every sequential attempt failed, two of them convincingly: a
quiet room sits near -83 dBFS and drifts more between arms than the effect, which once produced
a half-volume reading louder than full.

Measured while working this out, so nobody repeats it: Krisp costs **0.38 dB** on speech, and
voice CPU does not show up in renderer profiling at all, 6.5% of the renderer's main thread
against 90-164% of a core across the whole process.

## The patches

`plugin-modal-source-link.patch` is six lines. Vencord builds the github link in a plugin's
settings header from its own repo path and skips it for userplugins, so a hand-installed plugin
has nowhere to point. The patch lets a userplugin supply its own `sourceUrl`.

`patchWebpack-speed.patch` changes `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. It removes two kinds of repeated work.

Searching. Vencord checks every module against every patch string one at a time. A combined
regex goes in front, so the 98% of modules matching nothing skip the per-patch scan.

Compiling, the larger half. Vencord evaluated the module's whole source again after every
replacement and threw all but the last away. One module here is patched 21 times, so it compiled
21 times: 36 MB through the parser for a 24 MB bundle. It now compiles once, after every
replacement is applied. If that source doesn't parse it recompiles one replacement at a time,
which names the replacement at fault, so a broken patch still reports itself as before.

Time inside the patcher on a live client: 9,900 modules, 232 patches, 199 landing. Three cold
boots per row, every row patching the same 199 modules.

|                    | patcher CPU |
| ------------------ | ----------- |
| stock Vencord      | 1.57s       |
| + prefilter        | 1.21s       |
| + compile once     | 0.68s       |

## Checks

```
node check.mjs                       # header, profile, voice and mic-gain logic
powershell -File patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

Re-run `patcher-check.ps1` after updating Vencord. Updates overwrite `patchWebpack.ts` and take
both patcher changes with them.

## License

GPL-3.0-or-later, same as Vencord.
