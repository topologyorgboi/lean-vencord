# lean

a vencord plugin. strips some identifying headers, adds a mic volume that actually works on
vesktop, and makes vencord boot a bit faster.

## install

from your vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/patches/*.patch
pnpm build
```

skip the `git apply` line if you only want the plugin. the patches just make vencord boot
faster and put a source link in the plugin's settings header.

on vesktop `pnpm build` isn't enough. vesktop keeps its own copy of vencord and ignores
`vencordDir`, so copy the build over yourself:

```powershell
Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
```

restart, then turn lean on in settings > plugins.

then go turn **vencord > automatically update** off, or the updater quietly replaces those
files with the official build and the plugin is gone. it also pops up "vencord has been
updated!" with nothing in it, which is how that got noticed. vesktop itself doesn't touch the
files, it only checks they exist.

## headers

- `X-Super-Properties` gets rewritten so you look like some other windows box. build number
  and release channel are left alone since the server checks those.
- the three launch ids get overwritten, including `launch_signature`. that one is an actual
  client-mod detector: libdiscore's wasm walks `globalThis` looking for vencord, vesktop,
  betterdiscord and friends, then packs what it finds into the uuid it hands back. the names
  are hex-encoded and xored with `0x73`, which is why grepping for them finds nothing.
- `X-Debug-Options` and `X-Track` get dropped.
- `X-Discord-Timezone` and `X-Discord-Locale` get pinned to the profile so your city isn't
  attached to every request.
- `X-Fingerprint` stays. it ties register, login and captcha together for a session, so
  removing it breaks signup rather than hiding anything.

profiles are windows-only on purpose. `Sec-CH-UA-Platform` is a forbidden header, nothing in
the renderer can touch it, and it reports your real os anyway. claim macos and you just look
weirder than everyone else.

the plugin starts at `StartAt.Init`, earlier than plugins usually do, because on a warm boot
discord can fire its first request before a normal plugin is even running.

## speed

three toggles, each measured rather than guessed, but on one machine.

**freeze gradient names** is the one that matters. those looping username gradients never stop
and they're expensive: one on screen was around 17-20% cpu, about 3% once frozen. two on
screen was roughly 55% against 5%. spinners, typing dots and skeletons are skipped by name so
nothing looks hung.

it works on web animations, so it can't touch anything that isn't one. avatar decorations,
nameplates and animated avatars are animated webp handled by the image pipeline, and
`document.getAnimations()` never returns them. discord's own reduced motion setting covers
those. freezing animated images saved basically nothing, so that got dropped.

css can't do this, which is the surprising part. `animation-play-state: paused` computes as
"paused" on the element and its `::before` and the animation just keeps going. pausing the
animation object does work, so that's what both toggles use.

**idle pause** freezes the same loops plus transitions and blur while the window is in the
background. worth more on vesktop than you'd think, since vesktop turns chromium's background
throttling off.

**kill blur** removes backdrop blur. usually there's nothing to remove until a popout or modal
opens, which is where discord's blur actually lives.

tried and thrown away: turning off spellcheck (no real difference), `content-visibility` on
message rows (discord already virtualises the list), and freezing animated images.

## voice

discord ships two voice engines in the same bundle and only uses the native one where a real
`DiscordNative.nativeModules` can load `discord_voice`. vesktop runs the web client, so it
gets the browser one, where `setInputVolume` is literally this:

```js
setInputVolume(e){}
```

so discord's input volume slider does nothing on vesktop. there's nothing else to turn up
either, since every gain node in the graph belongs to someone else's voice. that's why your
mic can be quiet with no setting anywhere that explains it. the plugin checks the function
body rather than asking the store, because the getters answer the same on both engines.

the client row reads the global the app injects instead of the user agent, since vesktop just
says it's chrome.

### mic gain

this is the part the plugin exists for. chromium grabs the mic *before* windows applies
anything to it, so if your level comes from an equalizer apo preamp or some vendor dsp, none
of it shows up in discord. that was about 33 db of missing volume here. peaks and average were
down by the same amount, so it's plain volume, not eq.

nothing in discord or windows fixes it. toggling chromium's echo cancellation, noise
suppression and gain control every way round barely moved it.

so the plugin adds the gain itself, wrapping `getUserMedia` before discord ever sees the
track, with a limiter after it so shouting doesn't clip. at 0 db it does nothing at all and
doesn't even build an audio graph. it also skips the desktop app entirely, where
`getUserMedia` is only screen share and camera and boosting those would be silly.

since that gain node is now the only thing on the mic path, **discord's input volume slider is
wired to it**, which finally makes that slider do something on vesktop. the db setting is the
ceiling and the slider comes down from there.

checking it meant opening a boosted and an unboosted capture of the same mic at the same
moment and comparing them, which was the only way to get a stable reading. asking for 24 db
gave about 25.7, the extra being the compressor's own gain, and halving the slider halved the
volume like it should. don't bother measuring this one arm at a time, a quiet room drifts more
than the thing you're trying to measure.

two things found on the way, so nobody else wastes an evening: krisp costs almost nothing on
speech volume, and voice cpu doesn't show up in renderer profiling at all, so profiling the
renderer tells you nothing about a call.

## the patches

`plugin-modal-source-link.patch` is six lines. vencord builds the github link in a plugin's
settings header from its own repo path and skips it for userplugins, so a hand-installed
plugin has nowhere to point. this lets a userplugin supply its own `sourceUrl`.

`patchWebpack-speed.patch` touches `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. two bits of repeated work:

searching. vencord checks every module against every patch string one at a time. a combined
regex goes in front so the ~98% of modules that match nothing skip the per-patch scan.

compiling, which was the bigger half. vencord re-evaluated the module's whole source after
every single replacement and threw away all but the last. one module here gets patched 21
times, so it compiled 21 times. now it compiles once, after all the replacements. if the
result doesn't parse it falls back to one at a time, which is what names the broken
replacement, so errors still look the same as before.

that took the patcher from about 1.6s to 0.7s, roughly half from each change. same 199 patches
applied either way.

## checks

```
node test/check.mjs                       # header, profile, voice and mic-gain logic
powershell -File test/patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

the first needs no client and no build: node 23 and up strips the types itself, so it just
imports `lib/` and runs. re-run the second after updating vencord, since updates overwrite
`patchWebpack.ts` and take both patcher changes with them.

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
