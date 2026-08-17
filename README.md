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

Animations, transitions and blur pause while the window isn't focused. Worth more on
Vesktop than you'd expect, since it turns Chromium's own background throttling off.
There's a separate toggle to kill every backdrop blur if you want the GPU back.

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
