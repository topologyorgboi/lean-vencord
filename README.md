# Lean

Vencord userplugin. Strips the identifying headers Discord won't give you a setting for,
and comes with a patch that makes Vencord boot about twice as fast.

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

`patchWebpack-prefilter.patch` touches Vencord's `src/webpack/patchWebpack.ts`. Vencord
checks every module against every patch string one at a time. This puts a single combined
regex in front, so the 98.5% of modules that match nothing skip the scan entirely.

On a live client, 14,436 modules against 221 patch strings:

|                | before | after |
| -------------- | ------ | ----- |
| patcher CPU    | 1.55s  | 0.87s |
| Vencord total  | 2.07s  | 1.32s |

## Checks

```
node check.mjs                       # header and profile logic
powershell -File patcher-check.ps1   # cold boots the client, fails if a patch didn't apply
```

Re-run `patcher-check.ps1` after you update Vencord. Updates overwrite `patchWebpack.ts`
and take the prefilter with them.

## License

GPL-3.0-or-later, same as Vencord.
