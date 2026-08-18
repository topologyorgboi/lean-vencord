/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 betabuxx
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Request headers. The transports are hooked rather than Discord's request module, which has
 * no webpack module that survives an update.
 */

import { pickProfile, rewriteHeader, type RewriteOpts } from "../lib/spoof";
import { settings } from "../settings";

// rebuilt on settings change, not per header: discord sets 6-8 headers a request
let currentOpts: RewriteOpts = { profile: null, stripDebug: false, spoofTimezone: false };

let ourSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;
let ourFetch: typeof window.fetch | null = null;
let prevSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
let prevFetch: typeof window.fetch;

export function refreshOpts() {
    const s = settings.store;
    currentOpts = {
        profile: s.spoofClient ? pickProfile(s.deviceProfile) : null,
        stripDebug: s.stripDebugHeaders,
        spoofTimezone: s.spoofTimezone
    };
}

export function hookRequests() {
    // captured here, not at module load: another plugin may have wrapped these since, and
    // restoring an old snapshot would delete its wrapper
    prevSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    prevFetch = window.fetch;

    ourSetHeader = function (this: XMLHttpRequest, name: string, value: string) {
        const out = rewriteHeader(name, value, currentOpts);
        if (out === null) return;
        return prevSetHeader.call(this, name, out);
    };

    ourFetch = function (input: any, init?: RequestInit) {
        // read settings first: new Request() marks its input used, so a throw after it
        // leaves the fallback with a dead body
        const o = currentOpts;
        let req: Request;
        try {
            req = new Request(input, init);
        } catch {
            return prevFetch.call(window, input, init);
        }
        for (const [name, value] of [...req.headers]) {
            const out = rewriteHeader(name, value, o);
            if (out === null) req.headers.delete(name);
            else if (out !== value) req.headers.set(name, out);
        }
        return prevFetch.call(window, req);
    };

    XMLHttpRequest.prototype.setRequestHeader = ourSetHeader;
    window.fetch = ourFetch;
}

export function unhookRequests() {
    // only unwind if nothing wrapped us since, else leave another plugin's hook alone
    if (XMLHttpRequest.prototype.setRequestHeader === ourSetHeader) XMLHttpRequest.prototype.setRequestHeader = prevSetHeader;
    if (window.fetch === ourFetch) window.fetch = prevFetch;
    ourSetHeader = ourFetch = null;
}
