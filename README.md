# lean

a vencord plugin that does three things:

- strips identifying headers discord gives you no setting for
- adds a mic gain that actually works on vesktop
- cuts renderer overhead, mostly from animated username gradients

everything is a toggle. nothing overlaps notrack or silenttyping.

## install

from your vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/patches/*.patch
pnpm build
```

- skip `git apply` if you only want the plugin. the patches just speed up boot and put a
  source link in the plugin's settings header
- on vesktop, `pnpm build` is not enough. vesktop keeps its own copy of vencord and ignores
  `vencordDir`, so copy the build over yourself:

  ```powershell
  Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
  ```

- restart, then turn lean on in settings > plugins

> **turn off vencord > automatically update.** the updater replaces those files with the
> official build and the plugin is gone. it also pops up "vencord has been updated!" with
> nothing in it, which is how that got noticed. vesktop itself only checks the files exist,
> so it never overwrites them.

## headers

| header | what happens |
|---|---|
| `X-Super-Properties` | rewritten to some other windows box. build number and channel stay real, the server checks those |
| `client_launch_id`, `client_heartbeat_session_id`, `launch_signature` | overwritten, all three |
| `X-Debug-Options`, `X-Track` | dropped |
| `X-Discord-Timezone`, `X-Discord-Locale` | pinned to the profile, so your city is not on every request |
| `X-Fingerprint` | left alone. it ties register, login and captcha to one session, so removing it breaks signup instead of hiding anything |

`launch_signature` is the interesting one. it is an actual client-mod detector: libdiscore's
wasm walks `globalThis` for vencord, vesktop, betterdiscord and friends, then packs what it
finds into the uuid it hands back. the names are hex-encoded and xored with `0x73`, which is
why grepping for them finds nothing.

two other notes:

- profiles are windows-only on purpose. `Sec-CH-UA-Platform` is a forbidden header, no
  renderer script can touch it, and it reports your real os anyway. claim macos and you just
  look weirder than everyone else
- the plugin starts at `StartAt.Init`, earlier than plugins usually do, because on a warm boot
  discord fires its first request before a normal plugin is running

## speed

three toggles, each measured, all on one machine.

**freeze gradient names** is the one that matters.

- one gradient on screen: ~17-20% cpu, ~3% once frozen
- two on screen: ~55% against ~5%
- spinners, typing dots and skeletons are skipped by name, so nothing looks hung
- only touches web animations. avatar decorations, nameplates and animated avatars are
  animated webp from the image pipeline and never show up in `document.getAnimations()`.
  discord's own reduced motion setting covers those

css cannot do this, which is the surprising part. `animation-play-state: paused` computes as
"paused" on the element and its `::before` while the animation keeps running. pausing the
animation object does stop it, so that is what both toggles use.

**idle pause** freezes the same loops plus transitions and blur while the window is in the
background. worth more on vesktop than you would think, since vesktop turns chromium's
background throttling off.

**kill blur** removes backdrop blur. usually nothing to remove until a popout or modal opens,
which is where discord's blur lives.

tried, did nothing, thrown away: spellcheck off, `content-visibility` on message rows (the
list is already virtualised), freezing animated images.

## voice

discord ships two voice engines in one bundle and only uses the native one where a real
`DiscordNative.nativeModules` can load `discord_voice`. vesktop runs the web client, so it
gets the browser one, where `setInputVolume` is literally this:

```js
setInputVolume(e){}
```

so on vesktop:

- discord's input volume slider does nothing
- there is nothing else to turn up either, every other gain node in the graph belongs to
  someone else's voice
- your mic can be quiet with no setting anywhere that explains it

the plugin reads the function body instead of asking the store, because the getters answer the
same on both engines. the client name comes from the injected global, since vesktop's user
agent just says chrome.

### mic gain

the part the plugin exists for. chromium grabs the mic *before* windows applies anything, so
if your level comes from an equalizer apo preamp or some vendor dsp, none of it reaches
discord.

- about 33 db of missing volume here
- peaks and average were down by the same amount, so it is plain volume, not eq
- nothing in discord or windows fixes it. toggling chromium's echo cancellation, noise
  suppression and gain control every way round barely moved it

so the gain gets added in the plugin, wrapping `getUserMedia` before discord sees the track,
with a limiter after it so shouting does not clip.

- at 0 db it does nothing and does not even build an audio graph
- the desktop app is skipped entirely, where `getUserMedia` is only screen share and camera
- that gain node is now the only thing on the mic path, so **discord's input volume slider is
  wired to it** and finally does something on vesktop. the db setting is the ceiling, the
  slider comes down from it

checking it meant opening a boosted and an unboosted capture of the same mic at the same
moment and comparing them. asked 24 db, got about 25.7, the extra being the compressor's own
gain. halving the slider halved the volume, like it should. measuring one arm at a time is
useless, a quiet room drifts more than the thing being measured.

two things found on the way, so nobody else wastes an evening:

- krisp costs almost nothing on speech volume
- voice cpu never shows up in renderer profiling, so profiling the renderer says nothing about
  a call

## the patches

**`plugin-modal-source-link.patch`**, six lines. vencord builds the github link in a plugin's
settings header from its own repo path and skips userplugins, so a hand-installed plugin has
nowhere to point. this lets a userplugin supply its own `sourceUrl`.

**`patchWebpack-speed.patch`** touches `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. two bits of repeated work:

- *searching.* every module gets checked against every patch string one at a time. a combined
  regex goes in front, so the ~98% of modules that match nothing skip the per-patch scan
- *compiling*, the bigger half. the module's whole source was re-evaluated after every single
  replacement, all but the last thrown away. one module here gets patched 21 times, so it
  compiled 21 times. now it compiles once, after all the replacements. if the result does not
  parse it falls back to one at a time, which is what names the broken replacement, so errors
  read the same as before

about 1.6s to 0.7s on the patcher, roughly half from each change. same 199 patches applied
either way.

## checks

```
node test/check.mjs                       # header, profile, voice and mic-gain logic
powershell -File test/patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

the first needs no client and no build, node 23 and up strips the types itself. re-run the
second after updating vencord, since updates overwrite `patchWebpack.ts` and take both patcher
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
