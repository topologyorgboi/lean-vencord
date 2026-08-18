# lean

a vencord plugin. three things:

- strips identifying headers discord gives you no setting for
- adds a mic gain stage. the browser voice engine has none
- cuts renderer overhead, mostly animated username gradients

every part is a toggle. nothing here overlaps notrack or silenttyping.

## install

from your vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/patches/*.patch
pnpm build
```

- skip `git apply` if you only want the plugin. the patches speed up boot and add a source
  link to the plugin's settings header
- on vesktop, `pnpm build` is not enough. vesktop keeps its own copy of vencord and ignores
  `vencordDir`. copy the build across:

  ```powershell
  Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
  ```

- restart, then enable lean in settings > plugins

> **turn off vencord > automatically update.** it replaces those files with the official
> build. the plugin is gone. the "vencord has been updated!" popup with no changelog is that
> happening. vesktop itself only checks the files exist, so it never overwrites them.

## headers

| header | what happens |
|---|---|
| `X-Super-Properties` | rewritten to another windows machine. build number and channel stay real, the server checks those |
| `client_launch_id`, `client_heartbeat_session_id`, `launch_signature` | overwritten, all three |
| `X-Debug-Options`, `X-Track` | dropped |
| `X-Discord-Timezone`, `X-Discord-Locale` | pinned to the profile. the city is not on every request |
| `X-Fingerprint` | left alone. it ties register, login and captcha to one session. removing it breaks signup, it does not hide anything |

`launch_signature` is a client-mod detector. libdiscore's wasm walks `globalThis` for vencord,
vesktop, betterdiscord and others, then packs what it finds into the uuid it returns. the
names are hex-encoded and xored with `0x73`. grepping for them finds nothing.

- profiles are windows-only. `Sec-CH-UA-Platform` is a forbidden header. no renderer script
  can set it and it reports the real os, so a macos profile contradicts it on every request
- the plugin starts at `StartAt.Init`, earlier than plugins usually do. on a warm boot discord
  sends its first request before a normal plugin is running

## speed

three toggles. every number below is off one machine.

**freeze gradient names** does most of the work.

- one gradient on screen: 17-20% cpu. 3% once frozen
- two on screen: 55% against 5%
- spinners, typing dots and skeletons are excluded by name. a frozen spinner reads as a hung
  client
- it only covers web animations. avatar decorations, nameplates and animated avatars are
  animated webp from the image pipeline and never appear in `document.getAnimations()`.
  discord's reduced motion setting covers those

css cannot do this. `animation-play-state: paused` computes as "paused" on the element and its
`::before` while the animation keeps running. pausing the animation object does stop it. both
toggles use that.

**idle pause** freezes the same loops plus transitions and blur while the window is in the
background. vesktop turns chromium's background throttling off, so it does more there.

**kill blur** removes backdrop blur. nothing to remove until a popout or modal opens. that is
where discord's blur is.

dropped after measuring: spellcheck off, `content-visibility` on message rows (the list is
already virtualised), freezing animated images.

## voice

discord ships two voice engines in one bundle. the native one is used only where a real
`DiscordNative.nativeModules` can load `discord_voice`. vesktop runs the web client, so it
gets the browser one, where `setInputVolume` is this:

```js
setInputVolume(e){}
```

on vesktop that means:

- discord's input volume slider does nothing
- there is nothing else to raise. every other gain node in the graph belongs to someone else's
  voice
- the mic can be quiet with no setting that accounts for it

the getters answer the same on both engines, so the plugin reads the function body instead.
the client name comes from the injected global. vesktop's user agent reports plain chrome.

### mic gain

chromium takes the capture stream unprocessed. an equalizer apo preamp or a vendor dsp never
reaches discord.

- 33 db of loss measured here
- peaks and average dropped the same amount. level, not eq
- no discord or windows setting recovers it. chromium's echo cancellation, noise suppression
  and gain control were toggled every way round and moved it under 3 db

so the gain goes in the plugin. `getUserMedia` is wrapped before discord sees the track, with
a limiter after it so loud syllables do not clip.

- at 0 db it does nothing and builds no audio graph
- the desktop app is skipped. there `getUserMedia` carries only screen share and camera
- that gain node is the only thing on the mic path, so **discord's input volume slider is
  wired to it**. the db setting is the ceiling, the slider comes down from it

verified against a boosted and an unboosted capture of the same mic, opened at the same
moment. asked 24 db. measured 25.7. the extra 1.7 is the compressor's own gain. halving the
slider halved the level. do not measure one arm at a time, a quiet room drifts further than
the effect.

two things that fell out of the measuring. krisp costs almost nothing on speech volume. voice
cpu never appears in renderer profiling, so a renderer profile says nothing about a call.

## the patches

**`plugin-modal-source-link.patch`**, six lines. vencord builds the github link in a plugin's
settings header from its own repo path and skips userplugins. a hand-installed plugin has
nowhere to point. this lets a userplugin supply its own `sourceUrl`.

**`patchWebpack-speed.patch`** touches `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. two bits of repeated work:

- *searching*. every module is checked against every patch string one at a time. a combined
  regex goes in front. the ~98% of modules that match nothing skip the per-patch scan
- *compiling*, the larger half. the module's whole source was re-evaluated after every
  replacement and all but the last thrown away. one module here takes 21 replacements, so it
  compiled 21 times. it compiles once now, after all of them. if the result does not parse it
  falls back to one at a time, which names the broken replacement. errors read the same as
  before

1.6s to 0.7s on the patcher, roughly half from each change. same 199 patches applied either
way.

## checks

```
node test/check.mjs                       # header, profile, voice and mic-gain logic
powershell -File test/patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

the first needs no client and no build. node 23 and up strips the types itself. re-run the
second after updating vencord. updates overwrite `patchWebpack.ts` and take both patcher
changes with them.

## layout

```
index.tsx      the plugin object, start and stop
settings.ts    every setting and the one line of text on each
hooks/         headers.ts, mic.ts, perf.ts: the three things it does
lib/           the pure logic, no discord imports, which is why test/ can run it
ui/            the settings panel and its css
patches/       the two optional vencord patches
test/          the checks above
```

## license

gpl-3.0-or-later, same as vencord.
