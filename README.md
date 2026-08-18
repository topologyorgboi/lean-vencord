# lean

a vencord plugin that strips identifying request headers, gives vesktop a mic gain it has no other
way to get, and cuts down the renderer work discord does while you're not looking at it. every
part is a switch, and none of it duplicates notrack or silenttyping.

## install

from your vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/patches/*.patch
pnpm build
```

you can skip the `git apply` if all you want is the plugin. those two patches only make the boot
faster and add a source link to the plugin's settings header.

vesktop needs one extra step, since it keeps its own copy of vencord and ignores `vencordDir`:

```powershell
Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
```

restart it, then enable lean under settings > plugins.

before anything else though, turn off **vencord > automatically update**. it'll quietly swap those
files back to the official build and take the plugin with them. if you've ever seen the "vencord
has been updated!" popup with no changelog behind it, that was this. vesktop itself only checks
the files are there, so it never overwrites them.

## headers

| header | what happens |
|---|---|
| `X-Super-Properties` | rewritten to another windows machine. build number and channel stay real, since the server checks those |
| `client_launch_id`, `client_heartbeat_session_id`, `launch_signature` | overwritten, all three |
| `X-Debug-Options`, `X-Track` | dropped |
| `X-Discord-Timezone`, `X-Discord-Locale` | pinned to the profile, so your city isn't attached to every request |
| `X-Fingerprint` | left alone. it ties register, login and captcha to one session, so pulling it breaks signup rather than hiding anything |

`launch_signature` is the one that matters. it's a client-mod detector: libdiscore's wasm walks
`globalThis` looking for vencord, vesktop, betterdiscord and a few others, then folds whatever it
finds into the uuid it hands back. the names are hex-encoded and xored with `0x73`, so searching
the bundle for "vencord" turns up nothing.

profiles are windows-only, and that's deliberate. `Sec-CH-UA-Platform` is a forbidden header so
nothing in the renderer can touch it, and it reports your real os, so a macos profile would
contradict it on every request.

the plugin also starts at `StartAt.Init` rather than the usual point, because on a warm boot
discord gets its first request out before a normal plugin has loaded.

## speed

three switches, measured on my machine rather than guessed at.

**freeze gradient names** is where most of the win is. one animated username on screen sat around
17-20% cpu and about 3% once frozen, and two of them was roughly 55% against 5%. spinners, typing
dots and skeletons are excluded by name so nothing ends up looking like a hung client.

it only works on web animations, though. avatar decorations, nameplates and animated avatars are
animated webp going through the image pipeline, and `document.getAnimations()` never returns them,
so discord's own reduced motion setting is what covers those.

css can't do this on its own, which took a while to work out. `animation-play-state: paused`
computes as "paused" on both the element and its `::before` while the animation carries on
running. pausing the animation object does stop it, so that's what both switches use.

**idle pause** freezes the same loops plus transitions and blur whenever the window is in the
background. it does more on vesktop than you'd expect, since vesktop turns chromium's background
throttling off.

**kill blur** strips backdrop blur. most of the time there's nothing to strip until a popout or a
modal opens, which is where discord uses it.

a few things got measured and thrown out: turning off spellcheck, `content-visibility` on message
rows (the list is already virtualised), and freezing animated images.

## voice

discord ships two voice engines in the same bundle and only picks the native one where a real
`DiscordNative.nativeModules` can load `discord_voice`. vesktop runs the web client, so it gets
the browser one, and there `setInputVolume` is this:

```js
setInputVolume(e){}
```

so the input volume slider does nothing on vesktop. there's nothing else to turn up either,
because every other gain node in the graph belongs to somebody else's voice, which is how your mic
ends up quiet with no setting anywhere that explains it. the plugin reads the function body
instead of asking the store, since the getters answer identically on both engines.

### mic gain

chromium asks for the capture stream unprocessed, so anything applied on the windows side never
gets there. if your level comes from an equalizer apo preamp or a vendor dsp, discord never sees
it. that was about 33 db of loss here, with the peaks and the average both down by the same
amount, so it's level rather than eq.

nothing in discord or windows brings it back either. chromium's echo cancellation, noise
suppression and gain control got toggled every way round and moved it by under 3 db between them.

so the gain goes in the plugin instead: `getUserMedia` gets wrapped before discord sees the track,
with a limiter after it so loud syllables don't clip. at 0 db it does nothing and builds no audio
graph, and the desktop app is skipped, where `getUserMedia` only carries screen share and camera.

that gain node ends up being the only thing on the mic path, so discord's input volume slider is
wired straight to it, which is what makes it work there. the db setting is the ceiling and the
slider comes down from there.

i checked it by opening a boosted and an unboosted capture of the same mic at the same moment and
comparing the two. asking for 24 db came out at 25.7, the extra 1.7 being the compressor's own
gain, and halving the slider halved the level. don't measure one arm at a time, a quiet room
drifts further than the thing you're trying to see.

two other things fell out of it: krisp costs almost nothing on speech volume, and voice cpu never
shows up in renderer profiling, so a renderer profile tells you nothing about a call.

## the patches

`plugin-modal-source-link.patch` is six lines. vencord builds the github link in a plugin's
settings header out of its own repo path and skips userplugins, so a hand-installed plugin has
nowhere to point. this lets one supply its own `sourceUrl`.

`patchWebpack-speed.patch` touches `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. there are two bits of repeated work in there.

the first is searching. every module gets checked against every patch string one at a time, so a
combined regex goes in front and the ~98% of modules that match nothing skip the per-patch scan.

the second is compiling, which was the bigger half. the module's whole source was being
re-evaluated after every single replacement, with all but the last thrown away. one module here
takes 21 replacements, so it compiled 21 times. now it compiles once at the end, and if the result
doesn't parse it falls back to one at a time, which is what names the broken replacement, so
errors read the same as before.

together that took the patcher from about 1.6s to 0.7s, roughly half from each, with the same 199
patches applied either way.

## checks

```
node test/check.mjs                       # header, profile, voice and mic-gain logic
powershell -File test/patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

the first needs no client and no build, since node 23 and up strips the types itself. the second
is worth re-running after a vencord update, because updates overwrite `patchWebpack.ts` and take
both patcher changes with it.

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
