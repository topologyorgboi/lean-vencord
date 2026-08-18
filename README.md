# Lean

Vencord userplugin. Strips the identifying headers Discord won't give you a setting for,
and comes with a patch that cuts Vencord's startup patching from 1.57s to 0.68s.

## Install

From your Vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/*.patch
pnpm build
```

Skip the `git apply` line if you just want the plugin. The patches only make Vencord
boot faster and put a source link in the plugin's own settings header.

On Vesktop, `pnpm build` isn't enough. Vesktop keeps its own copy of Vencord and ignores
`vencordDir`, so you have to copy the build over yourself:

```powershell
Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
```

Restart, then turn Lean on in Settings > Plugins.

## What it does to your headers

- `X-Super-Properties` gets rewritten so your requests claim some other Windows box.
  Build number and release channel are left alone, since the server checks those.
- The three launch IDs get overwritten, `launch_signature` included. That one is an
  actual client-mod detector. libdiscore's WASM digs through `globalThis` for Vencord,
  Vesktop, BetterDiscord and friends, then packs whatever it finds into the UUID it
  hands back. The names are hex-encoded and XORed with `0x73`, which is why grepping
  the file turns up nothing.
- `X-Debug-Options` and `X-Track` get dropped.
- `X-Discord-Timezone` and `X-Discord-Locale` get pinned to the profile, so your city
  stops riding along on every request.
- `X-Fingerprint` stays. It ties register, login and captcha together for one session,
  so killing it breaks signup instead of hiding you.

Profiles are Windows-only. `Sec-CH-UA-Platform` is a forbidden header, nothing in the
renderer can touch it, and it reports your real OS anyway. Claim macOS and you just end
up looking stranger than everyone else.

The plugin starts at `StartAt.Init`, earlier than plugins normally do, because on a warm
boot Discord can fire its first API call before a normal plugin is even running.

## Speed

Three toggles, each measured on a live client rather than assumed.

**Freeze name effects** is the one that matters. Discord's looping username and avatar
cosmetics never stop, and they are not cheap. One on screen measured 17.1-19.7% CPU against
2.4-3.4% with it frozen, and about 1,620 style recalculations every twelve seconds against
60. Two on screen measured 55% against 5%. Spinners, typing dots and skeletons are excluded
by name, so a frozen one never reads as a hung client.

CSS cannot do this. `animation-play-state: paused` computes to "paused" on both the element
and its `::before`, and the animation keeps running anyway: 1,621 recalculations with the
rule against 1,608 without it. Pausing the animation object itself does work, so that is
what both toggles use.

**Idle pause** freezes those same loops, plus transitions and blur, while the window is in
the background. It is worth more on Vesktop than you'd expect, since Vesktop turns
Chromium's own background throttling off.

**Kill blur** removes every backdrop blur. There is usually nothing to remove until a popout
or modal opens, which is where Discord's blur actually lives.

Measured and dropped, so you know what isn't here: turning off spellcheck (7.9s against 7.6s
to type 320 characters, inside the noise), `content-visibility` on message rows (Discord
already virtualises the list, so barely anything offscreen is left to skip), and freezing
animated images (0.05s per 8s).

## Voice

Two read-only rows, because one of them explains a problem people spend a long time blaming on
their microphone.

Discord ships two voice engines in the same bundle and uses the native one only where a real
`DiscordNative.nativeModules` can load `discord_voice`. Vesktop loads the web client, so it gets
the browser engine, and on that engine `setInputVolume` is an empty function body:

```js
setInputVolume(e){}
```

Discord's **Input Volume slider does nothing there**. Nor is there anything else to turn up: every
gain node in the graph belongs to a remote user, so other people's volumes work and yours cannot
be touched. `bypassSystemInputProcessing` is stored and applied by nothing for the same reason.
The plugin reads the function body rather than asking the store, because every getter answers
on both engines and so cannot tell them apart.

The client row reads the global the app injects rather than the user agent, since Vesktop reports
itself as plain Chrome.

If the row says `browser` and you want the slider back, inject into the Discord desktop app
(`pnpm inject`) instead of running Vesktop. That is what selects the native engine.

Measured while this was being worked out, so nobody repeats it: Krisp costs **0.38 dB** on speech,
which is not what makes a mic quiet, and voice CPU does not show up in renderer profiling at all —
6.5% of the renderer's main thread against 90-164% of a core across the whole process.

## The patches

`plugin-modal-source-link.patch` is six lines. Vencord builds the github link in a plugin's
settings header from its own repo path, and skips it entirely for userplugins, so a plugin
installed by hand has nowhere to point. The patch lets a userplugin supply its own
`sourceUrl` and gets the same icon.

`patchWebpack-speed.patch` changes `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. It removes two kinds of repeated work.

Searching. Vencord checks every module against every patch string one at a time. A single
combined regex goes in front, so the 98% of modules that match nothing skip the per-patch
scan.

Compiling, which turned out to be the larger half. Vencord evaluated the module's whole
source again after every single replacement and threw all but the last result away. One
module here is patched 21 times, so it was compiled 21 times: 36 MB through the parser for
a 24 MB bundle. It now compiles once, after every replacement has been applied. If that
finished source doesn't parse, it recompiles one replacement at a time, which is what
names the replacement at fault, so a broken patch still reports itself the way it used to.

Time inside the patcher on a live client: 9,900 modules, 232 patches, 199 of them landing.
Three cold boots per row, and every row patched the same 199 modules.

|                    | patcher CPU |
| ------------------ | ----------- |
| stock Vencord      | 1.57s       |
| + prefilter        | 1.21s       |
| + compile once     | 0.68s       |

## Checks

```
node check.mjs                       # header and profile logic
powershell -File patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

Re-run `patcher-check.ps1` after you update Vencord. Updates overwrite `patchWebpack.ts`
and take both patcher changes with them.

## License

GPL-3.0-or-later, same as Vencord.
