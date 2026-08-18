# Lean

A Vencord plugin I made for myself. It strips a few identifying headers, adds a mic volume
control that actually works on Vesktop, and makes Vencord boot a bit faster.

Nothing here is clever. I got annoyed at some things and poked at them until they stopped
annoying me. Numbers below are from my own machine, so take them as "roughly this" rather
than anything scientific.

## Install

From your Vencord folder:

```
git clone https://github.com/topologyorgboi/lean-vencord.git src/userplugins/lean
git apply src/userplugins/lean/patches/*.patch
pnpm build
```

Skip the `git apply` line if you only want the plugin. The patches just make Vencord boot
faster and put a source link in the plugin's settings header.

On Vesktop, `pnpm build` isn't enough. Vesktop keeps its own copy of Vencord and ignores
`vencordDir`, so copy the build over yourself:

```powershell
Copy-Item dist\vencordDesktop* "$env:APPDATA\vesktop\sessionData\vencordFiles" -Force
```

Restart, then turn Lean on in Settings > Plugins.

Then go turn **Vencord > Automatically update** off, or the updater will quietly replace
those files with the official build and your plugin is gone. It also pops up "Vencord has
been updated!" with nothing in it, which is how I noticed. Vesktop itself doesn't touch the
files, it only checks they exist.

## Headers

- `X-Super-Properties` gets rewritten so you look like some other Windows box. Build number
  and release channel are left alone since the server checks those.
- The three launch IDs get overwritten, including `launch_signature`. That one is an actual
  client-mod detector: libdiscore's WASM goes through `globalThis` looking for Vencord,
  Vesktop, BetterDiscord and friends, then packs what it finds into the UUID it hands back.
  The names are hex-encoded and XORed with `0x73`, which is why grepping for them finds
  nothing. Took me a while to work that one out.
- `X-Debug-Options` and `X-Track` get dropped.
- `X-Discord-Timezone` and `X-Discord-Locale` get pinned to the profile so your city isn't
  attached to every request.
- `X-Fingerprint` stays. It ties register, login and captcha together for a session, so
  removing it breaks signup rather than hiding anything.

Profiles are Windows-only on purpose. `Sec-CH-UA-Platform` is a forbidden header, nothing in
the renderer can touch it, and it reports your real OS anyway. Claim macOS and you just look
weirder than everyone else.

The plugin starts at `StartAt.Init`, earlier than plugins usually do, because on a warm boot
Discord can fire its first request before a normal plugin is even running.

## Speed

Three toggles. I measured each one instead of guessing, but on one machine, so don't read too
much into the exact figures.

**Freeze gradient names** is the one that actually matters. Those looping username gradients
never stop and they're surprisingly expensive: one on screen was around 17-20% CPU, about 3%
once frozen. Two on screen was roughly 55% against 5%. Spinners, typing dots and skeletons are
skipped by name so nothing looks hung.

It works on Web Animations, so it can't touch anything that isn't one. Avatar decorations,
nameplates and animated avatars are animated WebP handled by the image pipeline, and
`document.getAnimations()` never returns them. Discord's own Reduced Motion setting covers
those. I tried freezing animated images too and it saved basically nothing, so I dropped it.

CSS can't do this, which surprised me. `animation-play-state: paused` computes as "paused" on
the element and its `::before` and the animation just keeps going. Pausing the animation object
does work, so that's what both toggles use.

**Idle pause** freezes the same loops plus transitions and blur while the window is in the
background. Worth more on Vesktop than you'd think, since Vesktop turns Chromium's background
throttling off.

**Kill blur** removes backdrop blur. Usually there's nothing to remove until a popout or modal
opens, which is where Discord's blur actually lives.

Things I tried and threw away: turning off spellcheck (no real difference), `content-visibility`
on message rows (Discord already virtualises the list), and freezing animated images.

## Voice

Discord ships two voice engines in the same bundle and only uses the native one where a real
`DiscordNative.nativeModules` can load `discord_voice`. Vesktop runs the web client, so it gets
the browser one, where `setInputVolume` is literally this:

```js
setInputVolume(e){}
```

So Discord's Input Volume slider does nothing on Vesktop. There's nothing else to turn up
either, since every gain node in the graph belongs to someone else's voice. That's why your mic
can be quiet with no setting anywhere that explains it. The plugin checks the function body
rather than asking the store, because the getters answer the same on both engines.

The client row reads the global the app injects instead of the user agent, since Vesktop just
says it's Chrome.

### Mic gain

This is the part I actually built the plugin for. Chromium grabs the mic *before* Windows
applies anything to it, so if your level comes from an Equalizer APO preamp or some vendor DSP,
none of it shows up in Discord. On my setup that was about 33 dB of missing volume. The peaks
and the average were both down by the same amount, so it's plain volume rather than EQ.

Nothing in Discord or Windows fixes it. I tried toggling Chromium's echo cancellation, noise
suppression and gain control every way round and it barely moved.

So the plugin adds the gain itself, wrapping `getUserMedia` before Discord ever sees the track,
with a limiter after it so shouting doesn't clip. At 0 dB it does nothing at all and doesn't
even build an audio graph. It also skips the desktop app entirely, where `getUserMedia` is only
screen share and camera and boosting those would be silly.

Since that gain node is now the only thing on the mic path, **Discord's Input Volume slider is
wired to it**, which finally makes that slider do something on Vesktop. The dB setting is your
ceiling and the slider comes down from there.

I checked it by opening a boosted and an unboosted capture of the same mic at the same moment
and comparing them, which was the only way to get a stable reading. Asking for 24 dB gave about
25.7, the extra being the compressor's own gain, and halving the slider halved the volume like
it should. Don't bother measuring this one arm at a time, a quiet room drifts more than the
thing you're trying to measure and I got some very confident nonsense that way.

Two things I found on the way, so nobody else wastes an evening: Krisp costs almost nothing on
speech volume, and voice CPU doesn't show up in renderer profiling at all, so profiling the
renderer tells you nothing about a call.

## The patches

`plugin-modal-source-link.patch` is six lines. Vencord builds the github link in a plugin's
settings header from its own repo path and skips it for userplugins, so a hand-installed plugin
has nowhere to point. This lets a userplugin supply its own `sourceUrl`.

`patchWebpack-speed.patch` touches `src/webpack/patchWebpack.ts` and adds
`src/webpack/diffErroredPatch.ts`. Two bits of repeated work:

Searching. Vencord checks every module against every patch string one at a time. A combined
regex goes in front so the ~98% of modules that match nothing skip the per-patch scan.

Compiling, which was the bigger half. Vencord re-evaluated the module's whole source after
every single replacement and threw away all but the last. One module here gets patched 21
times, so it compiled 21 times. Now it compiles once, after all the replacements. If the result
doesn't parse it falls back to one at a time, which is what names the broken replacement, so
errors still look the same as before.

On my client that took the patcher from about 1.6s to 0.7s, roughly half of it from each
change. Same 199 patches applied either way.

## Checks

```
node test/check.mjs                       # header, profile, voice and mic-gain logic
powershell -File test/patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

The first one needs no client and no build: Node 23 and up strips the types itself, so it
just imports `lib/` and runs. Re-run the second after updating Vencord, since updates
overwrite `patchWebpack.ts` and take both patcher changes with them.

## Layout

```
index.tsx      the plugin object, start and stop
settings.ts    every setting and the one line of text on each
hooks/         headers.ts, mic.ts, perf.ts: the three things it does
lib/           the pure logic, no Discord imports, which is why test/ can run it
ui/            the settings panel and its CSS
patches/       the two optional Vencord patches
test/          the checks above
```

## License

GPL-3.0-or-later, same as Vencord.
