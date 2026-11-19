/* House Hunter: Showings (encrypted) + Alerts & New Homes. Plain JS, no build step. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return "$" + Math.round(n).toLocaleString("en-US"); };
  var short$ = function (v) { return "$" + (v >= 1e6 ? (v / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "M" : Math.round(v / 1000) + "K"); };
  var KEY_STORE = "hh.showingsKey.v1", TAB_STORE = "hh.tab", VIEW_STORE = "hh.view", FILTER_STORE = "hh.filter", SEEN_STORE = "hh.alertsSeen", DISMISS_STORE = "hh.dismissed.v1";
  var GREEN = "#22a559", YELLOW = "#e8b923";
  var state = { tab: localStorage.getItem(TAB_STORE) || "showings", view: localStorage.getItem(VIEW_STORE) || "stops",
    filter: localStorage.getItem(FILTER_STORE) || "all", showings: null, dayId: null, alerts: null, enc: null, unlockError: "" };
  var IC = {
    nav: '<svg viewBox="0 0 24 24"><path d="M12 2.5 4.5 20.5l7.5-3.6 7.5 3.6z" fill="currentColor"/></svg>',
    call: '<svg viewBox="0 0 24 24"><path d="M6.6 3.5h3l1.5 4.2-2 1.4a12 12 0 0 0 5.8 5.8l1.4-2 4.2 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="currentColor"/></svg>',
    z: '<svg viewBox="0 0 24 24"><path d="M3.5 11 12 4l8.5 7v9.5h-17z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 13l2 2 3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>'
  };
  var btn = function (href, label, icon, primary) {
    if (!href) return "";
    var ext = /^https?:/.test(href);
    return '<a class="btn' + (primary ? " primary" : "") + '" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + (icon || "") + "<span>" + esc(label) + "</span></a>";
  };
  var mapsSearch = function (q) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q) + "&travelmode=driving"; };
  function toast(msg, action, fn) {
    var t = $("#toast"); t.innerHTML = ""; t.appendChild(document.createTextNode(msg));
    if (action) { var b = document.createElement("button"); b.className = "toastBtn"; b.type = "button"; b.textContent = action; b.onclick = function () { t.hidden = true; fn(); }; t.appendChild(b); }
    t.classList.toggle("act", !!action); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, action ? 5000 : 1800);
  }
  function fetchJSON(path) { return fetch(path + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  /* ---------- crypto ---------- */
  var b64d = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  var b64e = function (buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  function deriveRaw(pass, enc) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]).then(function (base) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64d(enc.salt), iterations: enc.iter, hash: "SHA-256" }, base, 256);
    });
  }
  function decryptWith(raw, enc) {
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]).then(function (k) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(enc.iv) }, k, b64d(enc.ct));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }
  function savedKey(enc) {
    try { var s = JSON.parse(localStorage.getItem(KEY_STORE) || "null"); if (s && s.salt === enc.salt && s.iter === enc.iter) return b64d(s.k); } catch (e) {}
    return null;
  }

  /* ---------- loading ---------- */
  function loadShowings() {
    return fetchJSON("data/showings.enc.json").then(function (enc) {
      state.enc = enc;
      var raw = savedKey(enc);
      if (!raw) { state.showings = null; return; }
      if (state.showings && state.showingsCt === enc.ct) return;
      return decryptWith(raw, enc).then(function (data) { state.showings = data; state.showingsCt = enc.ct; state.unlockError = ""; })
        .catch(function () { localStorage.removeItem(KEY_STORE); state.showings = null; state.unlockError = "The passcode changed. Enter the new one."; });
    }).catch(function () { state.enc = null; });
  }
  function loadAlerts() { return fetchJSON("data/alerts.json").then(function (a) { state.alerts = a; }).catch(function () { if (!state.alerts) state.alerts = { items: [] }; }); }
  /* Only rebuild the DOM when the data really changed: rebuilding tore down <img>s mid-download on every app open. */
  var lastSig = { s: null, a: null };
  function loadAll(manual) {
    var b = $("#refreshBtn"); b.classList.add("spin");
    return Promise.all([loadShowings(), loadAlerts()]).then(function () {
      b.classList.remove("spin");
      var sSig = (state.enc ? state.enc.ct : "none") + "|" + (state.showings ? 1 : 0) + "|" + state.unlockError + "|" + todayISO();
      var aSig = JSON.stringify(state.alerts || {});
      if (sSig !== lastSig.s) { lastSig.s = sSig; renderShowings(); }
      if (aSig !== lastSig.a) { lastSig.a = aSig; renderAlerts(); }
      if (manual) toast("Up to date");
    });
  }

  /* ---------- webhook (Grok Bot routine): URL + key live only in this device's localStorage ---------- */
  var HOOK_STORE = "hh.webhook.v1";
  function hookCfg() { try { var c = JSON.parse(localStorage.getItem(HOOK_STORE) || "null"); return c && c.url && c.key ? c : null; } catch (e) { return null; } }
  function postHook(payload) {
    var c = hookCfg(); if (!c) return Promise.reject(new Error("nocfg"));
    var body = JSON.stringify(Object.assign({ source: "house-hunter-app", sentAt: new Date().toISOString() }, payload));
    return fetch(c.url, { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key }, body: body })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r; },
            function (e) { throw new Error("blocked"); });
  }
  function hookErr(e) { return e.message === "blocked" ? "Couldn't reach the webhook (blocked by the browser or offline)" : e.message === "HTTP 401" || e.message === "HTTP 403" ? "Webhook key rejected" : "Webhook error: " + e.message; }
  function openSettings(focusHook) {
    $("#settingsBtn").onclick();
    if (focusHook) setTimeout(function () { $("#hookUrl").focus(); }, 250);
  }

  /* ---------- proposed day: on-device reorder + re-timing via OSRM ---------- */
  var ORDER_PREFIX = "hh.order.";
  function fmtT(m) { m = Math.round(m) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ":" + String(mi).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM"); }
  function fmtS(m) { return fmtT(m).replace(/ (AM|PM)$/, ""); }
  function durTxt(sec) { var m = Math.max(1, Math.round(sec / 60)), h = Math.floor(m / 60); return h ? h + " hr " + (m % 60) + " min" : m + " min"; }
  var ceil5 = function (m) { return Math.ceil(m / 5) * 5; };
  function fullAddr(s) { return String(s.address).split(",")[0] + ", " + (s.cityFull || s.city + ", CO"); }
  function gm(points, way) { var q = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(points[0]) + "&destination=" + encodeURIComponent(points[points.length - 1]) + "&travelmode=driving"; return way && way.length ? q + "&waypoints=" + encodeURIComponent(way.join("|")) : q; }
  function merc(lat, lon, z) { var sc = 256 * Math.pow(2, z), r = lat * Math.PI / 180; return [(lon + 180) / 360 * sc, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * sc]; }
  function savedOrder(day) {
    try { var o = JSON.parse(localStorage.getItem(ORDER_PREFIX + day.date) || "null"); if (o && o.gen === day.generated) return o; if (o) localStorage.removeItem(ORDER_PREFIX + day.date); } catch (e) {}
    return null;
  }
  /* returns the proposed day with any on-device order applied (pure: does not mutate the server copy) */
  function applyOrder(day) {
    var o = savedOrder(day); if (!o) return day;
    var d = JSON.parse(JSON.stringify(day)), by = {};
    d.showings.forEach(function (s) { by[s.zpid] = s; });
    var st = o.order.map(function (z) { return by[z]; }).filter(Boolean);
    if (st.length !== d.showings.length) return day;
    var per = d.minutesPerHome || 30, first = d.firstStart, t = first, names = ["Home"].concat(st.map(function (s) { return s.short; }), ["Home"]);
    var legMin = o.legs.map(function (l) { return ceil5(l.duration / 60); });
    st.forEach(function (s, i) {
      if (i) t = t + per + legMin[i];
      s.n = i + 1; s.startMin = t; s.endMin = t + per; s.time = fmtS(t) + "–" + fmtT(t + per);
      s.drive = durTxt(o.legs[i].duration) + " · " + (o.legs[i].distance / 1609.344).toFixed(1) + " mi from " + names[i];
    });
    var addrs = [d.homeAddr].concat(st.map(fullAddr), [d.homeAddr]);
    st.forEach(function (s, i) { s.nav = gm([addrs[i], addrs[i + 1]]); });
    var leave = first - legMin[0], back = st[st.length - 1].endMin + legMin[legMin.length - 1];
    var tot = o.legs.reduce(function (a, l) { return a + l.duration; }, 0), dist = o.legs.reduce(function (a, l) { return a + l.distance; }, 0);
    d.metrics = [{ value: fmtT(leave), label: "Leave home" }, { value: durTxt(tot), label: "Driving" }, { value: fmtT(back), label: "Back home" }];
    d.routeLinks = [{ title: "Full route", site: "Google Maps", href: gm([d.homeAddr, d.homeAddr], st.map(fullAddr)), mark: "★" }].concat(o.legs.map(function (l, i) {
      return { title: names[i] + " → " + names[i + 1], site: "Leave " + fmtT(i ? st[i - 1].endMin : leave), href: gm([addrs[i], addrs[i + 1]]), mark: i < st.length ? String(i + 1) : "H" };
    }));
    if (d.map) {
      d.map.legs = o.legs.map(function (l, i) { return { path: l.path, label: durTxt(l.duration) + " · " + (l.distance / 1609.344).toFixed(1) + " mi", x: l.x, y: l.y, ret: i === o.legs.length - 1 }; });
      (d.map.stops || []).forEach(function (ms) { var s = by[ms.id]; if (s && st.indexOf(s) >= 0) { ms.n = s.n; ms.time = fmtS(s.startMin); } else if (ms.id === "home") ms.time = "Leave " + fmtS(leave); });
    }
    d.showings = st; d.reordered = true;
    return d;
  }
  function reorder(day, order) {
    if (order.join() === day.showings.map(function (s) { return s.zpid; }).join()) {
      localStorage.removeItem(ORDER_PREFIX + day.date); renderShowings();
      if (hookCfg()) postHook({ action: "reorder", date: day.date, stops: stopsPayload(day) }).catch(function () {});
      return Promise.resolve();
    }
    var by = {}; day.showings.forEach(function (s) { by[s.zpid] = s; });
    var st = order.map(function (z) { return by[z]; });
    var pts = [day.homePt].concat(st.map(function (s) { return [s.lat, s.lon]; }), [day.homePt]);
    var url = "https://router.project-osrm.org/route/v1/driving/" + pts.map(function (p) { return p[1].toFixed(6) + "," + p[0].toFixed(6); }).join(";") + "?overview=false&steps=true&geometries=geojson";
    toast("Updating route…");
    return fetch(url).then(function (r) { return r.json(); }).then(function (R) {
      if (R.code !== "Ok") throw new Error(R.code);
      var pr = day.map && day.map.proj;
      var legs = R.routes[0].legs.map(function (lg) {
        var g = []; lg.steps.forEach(function (stp) { g = g.concat(stp.geometry.coordinates); });
        var path = "", x = 0, y = 0;
        if (pr) {
          var step = Math.max(1, Math.floor(g.length / 300)), xy = [];
          for (var k = 0; k < g.length; k += step) { var m = merc(g[k][1], g[k][0], pr.z); xy.push([((m[0] - pr.ox) * pr.f).toFixed(1), ((m[1] - pr.oy) * pr.f).toFixed(1)]); }
          path = xy.map(function (p) { return p.join(","); }).join(" ");
          var mid = xy[Math.floor(xy.length / 2)] || [280, 205]; x = Math.min(Math.max(+mid[0], 60), 500); y = Math.min(Math.max(+mid[1] - 14, 16), 396);
        }
        return { duration: lg.duration, distance: lg.distance, path: path, x: x, y: y };
      });
      localStorage.setItem(ORDER_PREFIX + day.date, JSON.stringify({ gen: day.generated, order: order, legs: legs, at: Date.now() }));
      var nd = applyOrder(day);
      if (hookCfg()) postHook({ action: "reorder", date: day.date, stops: stopsPayload(nd) }).catch(function () {});
      renderShowings(); toast("Route updated");
    }).catch(function () { toast("Couldn't update the route. Try again."); });
  }
  function stopsPayload(d) { return d.showings.map(function (s) { return { zpid: s.zpid, address: fullAddr(s), start: fmtT(s.startMin), end: fmtT(s.endMin) }; }); }
  function bindReorder(el, day) {
    var list = $(".stack", el); if (!list) return;
    var order = function () { return $$(".proposedStop", list).map(function (c) { return c.dataset.zpid; }); };
    var commit = function () { var o = order(); if (o.join() !== day.showings.map(function (s) { return s.zpid; }).join()) reorder(state.serverProposal, o); };
    $$(".mv", list).forEach(function (b) { b.onclick = function (e) {
      e.stopPropagation(); var c = b.closest(".proposedStop"), sib = b.dataset.d === "up" ? c.previousElementSibling : c.nextElementSibling;
      if (!sib) return; if (b.dataset.d === "up") list.insertBefore(c, sib); else list.insertBefore(sib, c); commit(); }; });
    $$(".grip", list).forEach(function (g) {
      var card = g.closest(".proposedStop"), timer = null, drag = false, y0 = 0, pid = null;
      var start = function () { drag = true; card.classList.add("dragging"); list.classList.add("sorting"); if (navigator.vibrate) navigator.vibrate(10); };
      g.addEventListener("pointerdown", function (e) { pid = e.pointerId; y0 = e.clientY; g.setPointerCapture(pid); timer = setTimeout(start, e.pointerType === "mouse" ? 0 : 220); });
      g.addEventListener("pointermove", function (e) {
        if (!drag) { if (Math.abs(e.clientY - y0) > 8) clearTimeout(timer); return; }
        e.preventDefault(); card.style.transform = "translateY(" + (e.clientY - y0) + "px)";
        var mid = card.getBoundingClientRect(), cy = mid.top + mid.height / 2;
        var prev = card.previousElementSibling, next = card.nextElementSibling;
        if (prev && cy < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { list.insertBefore(card, prev); y0 -= prev.offsetHeight + 14; card.style.transform = "translateY(" + (e.clientY - y0) + "px)"; }
        else if (next && cy > next.getBoundingClientRect().top + next.offsetHeight / 2) { list.insertBefore(next, card); y0 += next.offsetHeight + 14; card.style.transform = "translateY(" + (e.clientY - y0) + "px)"; }
      });
      var end = function () { clearTimeout(timer); if (!drag) return; drag = false; card.style.transform = ""; card.classList.remove("dragging"); list.classList.remove("sorting"); commit(); };
      g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
    });
  }
  var SENT_PREFIX = "hh.cartSent.";
  function cartState(day) { try { var o = JSON.parse(localStorage.getItem(SENT_PREFIX + day.date) || "null"); return o && Date.now() - o.at < 10 * 60 * 1000 ? o : null; } catch (e) { return null; } }
  function sendCart(day, b) {
    if (!hookCfg()) { openSettings(true); return; }
    b.disabled = true; b.textContent = "Sending…";
    postHook({ action: "cart", date: day.date, stops: stopsPayload(day) }).then(function () {
      localStorage.setItem(SENT_PREFIX + day.date, JSON.stringify({ at: Date.now() })); renderShowings();
    }, function (e) { b.disabled = false; b.textContent = "Send to ShowingTime cart"; toast(hookErr(e)); });
  }

  /* ---------- showings tab ---------- */
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function isPast(day) { return day.status === "Completed" || (!!day.date && day.date < todayISO()); }
  function dayGroups() {
    var d = state.showings || {}, all = d.days || [];
    var upcoming = all.filter(function (x) { return !isPast(x); }).sort(function (x, y) { return (x.date || "").localeCompare(y.date || ""); });
    var past = all.filter(isPast).sort(function (x, y) { return (y.date || "").localeCompare(x.date || ""); });
    return { upcoming: upcoming, past: past, proposed: d.proposed || null };
  }
  function findDay(id) {
    var g = dayGroups();
    if (id === "proposed") return g.proposed;
    return g.upcoming.concat(g.past).filter(function (x) { return x.id === id; })[0] || null;
  }
  function unlockHTML() {
    var none = !state.enc;
    return '<div class="card unlock"><div class="lockIco">' + IC.lock + "</div><h2>Showings are locked</h2>" +
      (none ? "<p>No showing data has been published yet.</p>" :
      '<p>Enter your passcode once. This iPhone will remember it.</p>' +
      '<form id="unlockForm" autocomplete="off"><input class="field" id="pass" type="password" inputmode="text" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode">' +
      '<button class="btn primary" type="submit" id="unlockGo">Unlock</button></form><div class="err" id="unlockErr">' + esc(state.unlockError) + "</div>") +
      '<p class="fine">Codes and access details are encrypted on the server and only decrypted on your device.</p></div>';
  }
  var thumbSize = function (u) { return String(u).replace(/-[a-z0-9_]+\.(jpg|webp)$/i, "-cc_ft_384.jpg"); };
  var HOUSE = '<svg viewBox="0 0 24 24"><path d="M4 11.2 12 4.5l8 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 20.5v-5.5h5v5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function thumb(s) {
    return s.photo ? '<div class="thumb"><img data-src="' + esc(thumbSize(s.photo)) + '" data-pri="0" alt=""></div>' : '<div class="thumb none">' + HOUSE + "</div>";
  }
  function basics(s, withBuilt) {
    return [s.beds ? s.beds + " bd" : "", s.baths ? s.baths + " ba" : "", s.sqft ? Number(s.sqft).toLocaleString() + " sqft" : "", s.acres ? s.acres + " ac" : "", withBuilt && s.built ? "Built " + s.built : ""].filter(Boolean).join(" · ");
  }
  /* shared head: thumb | number+time, address, basics | price */
  function head(s, timeLine, right) {
    return '<div class="sHead">' + thumb(s) + '<div class="sMain">' + (timeLine ? '<div class="sTime">' + timeLine + "</div>" : "") +
      '<div class="sAddr">' + esc(s.address) + '</div><div class="sBasics">' + esc(basics(s, !timeLine)) + "</div></div>" +
      '<div class="sRight">' + (s.price ? '<b>' + short$(s.price) + "</b>" : "") + (right || "") + "</div></div>";
  }
  var driveLine = function (txt) { return txt ? '<div class="sDrive">' + IC.nav + "<span>" + esc(txt) + "</span></div>" : ""; };
  function endTime(s, day) {
    if (s.end) return new Date(s.end);
    var iso = day && day.date; if (!iso) return null;
    var m = String(s.time || "").match(/[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i) || String(s.time || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i);
    if (!m) return new Date(iso + "T23:59:00");
    var h = +m[1] % 12 + (/pm/i.test(m[3]) ? 12 : 0);
    return new Date(iso + "T" + String(h).padStart(2, "0") + ":" + m[2] + ":00");
  }
  function isSeen(s, day) {
    if (s.seen === true) return true; if (s.seen === false) return false;
    if (s.proposed || (day && day.status === "Proposed")) return false;
    if (s.feedbackUrl || s.feedbackDone) return true;
    if (day && isPast(day)) return true;
    var e = endTime(s, day); return !!(e && Date.now() > e.getTime());
  }
  function accessInfo(s) {
    if (!(s.code || s.access || s.instructions)) return "";
    var isDoor = /door/i.test(s.code || ""), code = String(s.code || "").replace(/\s*\(door code\)/i, "");
    return '<details class="accessInfo"><summary>Show access info</summary><div class="aiBody">' +
      (code ? '<div><span>' + (isDoor ? "Door code" : "Lockbox") + '</span><b class="aiCode">' + esc(code) + "</b></div>" : "") +
      (s.access ? "<div><span>Access</span><p>" + esc(s.access) + "</p></div>" : "") +
      (s.instructions ? "<div><span>At the door</span><p>" + esc(s.instructions) + "</p></div>" : "") + "</div></details>";
  }
  function take(s) {
    if (!(s.rating || s.notes)) return "";
    return '<div class="take">' + (s.rating ? '<span class="stars">' + "★".repeat(s.rating) + "☆".repeat(5 - s.rating) + "</span>" : "") + (s.notes ? "<p>" + esc(s.notes) + "</p>" : "") + "</div>";
  }
  function seenStopCard(s) {
    var pill = s.feedbackDone ? '<span class="tag green">Feedback sent</span>' : '<span class="tag">Seen</span>';
    var fb = s.feedbackUrl && !s.feedbackDone ? '<a class="btn primary feedbackBtn" href="' + esc(s.feedbackUrl) + '" target="_blank" rel="noopener noreferrer">' + IC.doc + "<span>Leave feedback</span></a>" : "";
    return '<article class="card stop seenStop">' + head(s, "", pill) + fb + take(s) +
      '<div class="btns one">' + btn(s.zillow, "Zillow", IC.z) + "</div>" + accessInfo(s) + "</article>";
  }
  function proposedStopCard(s) {
    return '<article class="card stop proposedStop" data-zpid="' + esc(s.zpid) + '">' + '<div class="mvBox"><button class="mv" data-d="up" type="button" aria-label="Move up">▴</button><span class="grip" aria-label="Drag to reorder">⋮⋮</span><button class="mv" data-d="down" type="button" aria-label="Move down">▾</button></div>' + head(s, '<i class="n p">' + esc(s.n) + "</i>" + esc(s.time)) +
      driveLine(s.drive ? s.drive.replace(/ · [\d.]+ mi/, "") : "") +
      '<div class="btns">' + btn(s.nav, "Navigate", IC.nav, true) + btn(s.zillow, "Zillow", IC.z) + "</div></article>";
  }
  function stopCard(s, day) {
    if (s.proposed) return proposedStopCard(s);
    if (isSeen(s, day)) return seenStopCard(s);
    var isDoor = /door/i.test(s.code || ""), code = String(s.code || "").replace(/\s*\(door code\)/i, "");
    var tel = s.phone ? "tel:" + String(s.phone).replace(/[^0-9+]/g, "") : "";
    var pend = s.confirmed === false;
    return '<article class="card stop">' + head(s, '<i class="n' + (pend ? " p" : "") + '">' + esc(s.n) + "</i>" + esc(s.time) + (pend ? ' <span class="tag amber">Requested</span>' : "")) +
      driveLine(s.navFrom) +
      (code ? '<div class="codeRow"><span>' + (isDoor ? "Door code" : "Lockbox") + '</span><b>' + esc(code) + "</b></div>" : "") +
      (s.flag ? '<div class="flag">' + esc(s.flag) + "</div>" : "") +
      (s.instructions ? '<div class="door">' + esc(s.instructions) + "</div>" : "") + take(s) +
      '<div class="btns">' + btn(s.nav, "Navigate", IC.nav, true) + btn(tel, "Call agent", IC.call) + btn(s.zillow, "Zillow", IC.z) + btn(s.confirmUrl, "Edit showing", IC.doc) + btn(s.feedbackUrl, "Leave feedback", IC.doc) + "</div></article>";
  }
  function mapSVG(m) {
    if (!m) return "";
    var halo = 'paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"', font = 'font-family="Roboto, Arial, sans-serif"';
    var o = '<svg viewBox="0 0 560 410" role="img" aria-label="Route map"><rect width="560" height="410" fill="#f5f2ea"/>';
    if (m.image) o += '<image href="' + esc(m.image) + '" x="0" y="0" width="560" height="410" preserveAspectRatio="none"/>';
    if (m.reservoir) o += '<path d="' + m.reservoir + '" fill="#aad3f5"/>' +
      '<path d="' + m.primary + '" fill="none" stroke="#d6d1c4" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="' + m.primary + '" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + m.trunk + '" fill="none" stroke="#e8c35a" stroke-width="3.5" stroke-linejoin="round"/><path d="' + m.trunk + '" fill="none" stroke="#fde293" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="' + m.motorway + '" fill="none" stroke="#e0a33a" stroke-width="4.5" stroke-linejoin="round"/><path d="' + m.motorway + '" fill="none" stroke="#fbc35d" stroke-width="3" stroke-linejoin="round"/>';
    if (m.attribution) o += '<text x="554" y="404" text-anchor="end" font-size="8" fill="#555" ' + font + " " + halo + ">" + esc(m.attribution) + "</text>";
    (m.towns || []).forEach(function (t) { o += '<text x="' + t[1] + '" y="' + t[2] + '" text-anchor="middle" font-size="10" fill="#5f6368" ' + font + " " + halo + ">" + esc(t[0]) + "</text>"; });
    (m.legs || []).forEach(function (l) { o += '<polyline points="' + l.path + '" fill="none" stroke="#1a2a9e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="' + (l.ret ? 0.5 : 1) + '"/>'; });
    (m.legs || []).forEach(function (l) { o += '<polyline points="' + l.path + '" fill="none" stroke="' + (l.ret ? "#8fa0ff" : "#4a5cff") + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>'; });
    (m.shields || []).forEach(function (s) { o += '<rect x="' + (s[1] - 11) + '" y="' + (s[2] - 7) + '" width="22" height="14" rx="3" fill="' + (s[0] === "25" ? "#1f5fbf" : "#2e7d4f") + '" stroke="#fff"/><text x="' + s[1] + '" y="' + (s[2] + 3.5) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#fff" ' + font + ">" + esc(s[0]) + "</text>"; });
    (m.legs || []).forEach(function (l) { var w = l.label.length * 6.2 + 12; o += '<rect x="' + (l.x - w / 2) + '" y="' + (l.y - 10) + '" width="' + w + '" height="18" rx="9" fill="#fff" stroke="#c7c3b8"/><text x="' + l.x + '" y="' + (l.y + 3) + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="#202124" ' + font + ">" + esc(l.label) + "</text>"; });
    (m.stops || []).forEach(function (s) {
      var fill = s.confirmed === null ? "#d93025" : s.confirmed ? GREEN : YELLOW;
      o += '<circle cx="' + s.x + '" cy="' + s.y + '" r="11" fill="' + fill + '" stroke="#fff" stroke-width="2.5"/><text x="' + s.x + '" y="' + (s.y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" ' + font + ">" + esc(s.n) + "</text>" +
        '<text x="' + s.lx + '" y="' + s.ly + '" text-anchor="' + s.anchor + '" font-size="12" font-weight="700" fill="#202124" ' + font + " " + halo + ">" + esc(s.name) + "</text>" +
        '<text x="' + s.lx + '" y="' + (s.ly + 14) + '" text-anchor="' + s.anchor + '" font-size="11" fill="#3c4043" ' + font + " " + halo + ">" + esc(s.time) + "</text>";
    });
    return o + "</svg>";
  }
  function routeHTML(day) {
    var legs = (day.map && day.map.legs) || [];
    var rows = (day.routeLinks || []).map(function (l, i) {
      var cls = l.mark === "★" ? "s" : l.mark === "H" ? "h" : "g";
      var leg = i > 0 && legs[i - 1] ? legs[i - 1].label : "";
      return '<a class="linkRow" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer"><span class="mark ' + cls + '">' + esc(l.mark) + '</span><span><span class="t">' + esc(l.title) + '</span><br><span class="s">' + esc(l.site) + (leg ? " · " + esc(leg) : "") + '</span></span><span class="go">›</span></a>';
    }).join("");
    return '<div class="gap"></div>' +
      '<div class="card mapBox">' + mapSVG(day.map) + '<div class="legend"><span><i style="background:' + GREEN + '"></i>Confirmed</span><span><i style="background:' + YELLOW + '"></i>Not confirmed</span><span><i style="background:#d93025"></i>Home</span></div></div>' +
      '<div class="gap"></div><div class="card links">' + rows + "</div>";
  }
  function table(cols, rows, cls) {
    return '<div class="card tblWrap"><table><thead><tr>' + cols.map(function (c, i) { return "<th" + (cls && cls[i] === "r" ? ' class="r"' : "") + ">" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return '<td class="' + ((cls && cls[i]) || "") + '">' + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  var a = function (href, label) { return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : ""; };
  function compareHTML(day) {
    var rows = day.showings.map(function (s) {
      var dash = function (v) { return v == null || v === "" ? "—" : esc(v); };
      return [esc(s.n + ". " + s.short), s.price ? short$(s.price) : "—", s.price && s.sqft ? "$" + Math.round(s.price / s.sqft) : "—", s.sqft ? Number(s.sqft).toLocaleString() : "—", dash(s.acres), dash(s.built), esc((s.beds || "—") + "/" + (s.baths || "—")), dash(s.hoa), dash(s.style),
        s.rating ? '<span class="stars">' + "★".repeat(s.rating) + "</span>" + (s.notes ? "<br>" + esc(s.notes) : "") : esc(s.notes || "—")];
    });
    return '<div class="gap"></div>' +
      table(["Home", "Price", "$/sq ft", "Sq ft", "Acres", "Built", "Bd/Ba", "HOA", "Style", "Your take"], rows, ["", "r", "r", "r", "r", "r", "r", "mid", "mid", "wide"]);
  }
  function detailsHTML(day) {
    var rows = day.showings.filter(function (s) { return !isSeen(s, day); }).map(function (s) {
      return [esc(s.address), esc(s.date), esc(s.time), esc(s.code), esc(s.mls), esc(s.access), esc(s.instructions), esc(s.agent), a(s.confirmUrl, s.confirmLabel), a(s.zillow, "Listing")];
    });
    return '<div class="secHead"><h2>All confirmation details</h2></div>' +
      table(["Home", "Date", "Time", "Lockbox code", "MLS", "Access", "Instructions", "Listing agent", "Confirmation", "Zillow"], rows, ["", "nw", "nw", "ok nw", "nw", "wide", "wide", "mid", "nw", "nw"]);
  }
  function dayView(day) {
    if (day.status === "Proposed") { state.serverProposal = day; day = applyOrder(day); }
    var M = function (v, l) { return '<div class="metric"><b>' + esc(v) + "</b><span>" + esc(l) + "</span></div>"; };
    var prop = day.status === "Proposed", past = !prop && isPast(day);
    var allSeen = !prop && day.showings.every(function (s) { return isSeen(s, day); });
    var metrics = (day.metrics || []).map(function (m) { return M(m.value, m.label); }).join("");
    if (allSeen) {
      var todo = day.showings.filter(function (s) { return s.feedbackUrl && !s.feedbackDone; }).length, sent = day.showings.filter(function (s) { return s.feedbackDone; }).length;
      var rated = day.showings.filter(function (s) { return s.rating; });
      metrics = M(day.showings.length, "Seen") + M(todo ? todo + " due" : sent + "/" + day.showings.length, "Feedback") +
        M(rated.length ? (rated.reduce(function (t, s) { return t + s.rating; }, 0) / rated.length).toFixed(1) + "★" : "—", "Rating");
    }
    var views = [["stops", "Stops"]].concat(allSeen ? [] : [["map", "Route"]], [["compare", "Compare"]], prop || allSeen ? [] : [["details", "Details"]]);
    var view = views.some(function (v) { return v[0] === state.view; }) ? state.view : "stops";
    var body = "";
    if (view === "map") body = routeHTML(day);
    else if (view === "compare") body = compareHTML(day);
    else if (view === "details") body = detailsHTML(day);
    else body = '<div class="stack" style="margin-top:12px">' + day.showings.map(function (s) { return stopCard(s, day); }).join("") + "</div>";
    var badge = prop ? '<span class="tag amber">Proposed</span>' : past || allSeen ? '<span class="tag">Done</span>' : "";
    var cart = "";
    if (prop) {
      var cs = cartState(day);
      cart = '<button class="btn primary cartBtn" id="cartBtn" type="button"' + (cs ? " disabled" : "") + ">" + (cs ? "Sent, adding to cart" : "Send to ShowingTime cart") + "</button>" +
        (day.reordered ? '<button class="resetOrder" id="resetOrder" type="button">Reset order</button>' : "");
    }
    var title = prop ? (day.date ? new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Proposed route") : day.label || day.title;
    return '<div class="card dayCard' + (prop ? " proposed" : "") + '"><div class="dayTop"><div class="dayTitle">' + esc(title) + "</div>" + badge + '</div><div class="metrics">' + metrics + "</div>" + cart + "</div>" +
      '<div class="seg" role="tablist" style="margin-top:12px">' + views.map(function (v) { return '<button data-view="' + v[0] + '" class="' + (view === v[0] ? "on" : "") + '">' + v[1] + "</button>"; }).join("") + "</div>" + body;
  }
  function emptyHTML() {
    return '<div class="card emptyState">' + HOUSE + "<p>No showings. Add homes to Shows before Hoes.</p></div>";
  }
  function pastHTML(past) {
    if (!past.length) return "";
    return '<details class="past"' + (state.pastOpen ? " open" : "") + '><summary><span>Past showings</span><em>' + past.length + '</em><i class="chev">›</i></summary><div class="card links pastList">' +
      past.map(function (d) { return '<button class="linkRow" data-day="' + esc(d.id) + '"><span class="mark">' + esc(String(d.showings.length)) + '</span><span><span class="t">' + esc(d.title) + '</span><br><span class="s">' + esc(d.showings.map(function (s) { return s.short; }).join(" · ")) + '</span></span><span class="go">›</span></button>'; }).join("") + "</div></details>";
  }
  function renderShowings() {
    var el = $("#tab-showings");
    if (!state.showings) { el.innerHTML = unlockHTML(); bindUnlock(); return; }
    var g = dayGroups(), html = "";
    var open = state.dayId ? findDay(state.dayId) : null;
    if (open && isPast(open) && open.status !== "Proposed") {
      html = '<button class="backLink" id="backBtn">‹ Showings</button>' + dayView(open);
    } else {
      var active = g.upcoming.slice(); if (g.proposed) active.push(g.proposed);
      if (!active.length) html = emptyHTML();
      else {
        var cur = (open && active.indexOf(open) >= 0) ? open : active[0];
        var chips = active.length > 1 ? '<div class="dayChips">' + active.map(function (d) { return '<button class="chip' + (d === cur ? " on" : "") + (d.status === "Proposed" ? " prop" : "") + '" data-day="' + esc(d.id) + '">' + esc(d.label || d.date) + "</button>"; }).join("") + "</div>" : "";
        html = chips + dayView(cur);
      }
      html += pastHTML(g.past);
    }
    el.innerHTML = html;
    $$("[data-view]", el).forEach(function (b) { b.onclick = function () { state.view = b.dataset.view; localStorage.setItem(VIEW_STORE, state.view); renderShowings(); window.scrollTo({ top: 0 }); }; });
    $$("[data-day]", el).forEach(function (b) { b.onclick = function () { state.dayId = b.dataset.day; renderShowings(); window.scrollTo({ top: 0 }); }; });
    var bk = $("#backBtn", el); if (bk) bk.onclick = function () { state.dayId = null; renderShowings(); window.scrollTo({ top: 0 }); };
    var pd = $("details.past", el); if (pd) pd.addEventListener("toggle", function () { state.pastOpen = pd.open; });
    $$(".thumb img", el).forEach(queueImg);
    var cb = $("#cartBtn", el); if (cb && state.serverProposal) cb.onclick = function () { sendCart(applyOrder(state.serverProposal), cb); };
    var ro = $("#resetOrder", el); if (ro) ro.onclick = function () { localStorage.removeItem(ORDER_PREFIX + state.serverProposal.date); renderShowings(); };
    if ($(".proposedStop", el)) bindReorder(el, applyOrder(state.serverProposal));
  }
  function bindUnlock() {
    var f = $("#unlockForm"); if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var pass = $("#pass").value, go = $("#unlockGo"), err = $("#unlockErr");
      if (!pass) return;
      go.disabled = true; go.textContent = "Unlocking…"; err.textContent = "";
      deriveRaw(pass, state.enc).then(function (raw) {
        return decryptWith(raw, state.enc).then(function (data) {
          localStorage.setItem(KEY_STORE, JSON.stringify({ salt: state.enc.salt, iter: state.enc.iter, k: b64e(raw) }));
          state.showings = data; state.unlockError = ""; renderShowings(); toast("Unlocked");
        });
      }).catch(function () { go.disabled = false; go.textContent = "Unlock"; err.textContent = "That passcode didn't work. Try again."; $("#pass").select(); });
    };
  }

  /* ---------- robust photo loading ----------
     iOS showed half-drawn photos: big 1536px JPEGs were cut off mid-download (the cards were rebuilt on every app open /
     refresh, and flaky cellular), and Safari paints whatever bytes arrived. Now each photo is fetched in full (CORS is open on
     photos.zillowstatic.com), checked against Content-Length, decoded, then faded in; a short/failed download retries once. */
  var cardSize = function (u) { return String(u).replace(/-cc_ft_\d+\.(jpg|webp)$/, "-cc_ft_960.$1"); };
  var fullSize = function (u) { return String(u).replace(/-cc_ft_\d+\.(jpg|webp)$/, "-cc_ft_1536.$1"); };
  var blobCache = {}, inflight = {}, queue = [], active = 0, MAXC = 4;
  function getBlobURL(url) {
    if (blobCache[url]) return Promise.resolve(blobCache[url]);
    if (inflight[url]) return inflight[url];
    var attempt = function (n) {
      return fetch(n ? url + (url.indexOf("?") < 0 ? "?" : "&") + "r=" + Date.now() : url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: n ? "reload" : "default" })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          var len = +r.headers.get("content-length") || 0;
          return r.blob().then(function (b) {
            if (!/^image\//.test(b.type) || b.size < 2000 || (len && b.size < len)) throw new Error("short");
            return b;
          });
        })
        .catch(function (e) { if (!n) return attempt(1); throw e; });
    };
    inflight[url] = attempt(0).then(function (b) { var u = URL.createObjectURL(b); blobCache[url] = u; delete inflight[url]; return u; },
      function (e) { delete inflight[url]; throw e; });
    return inflight[url];
  }
  function show(img) { img.classList.add("in"); img.parentNode && img.parentNode.classList.add("ok"); }
  function setSrc(img, src) {
    return new Promise(function (res, rej) {
      img.onload = function () { (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { img.naturalWidth ? res() : rej(); }); };
      img.onerror = rej; img.src = src;
    });
  }
  function loadImg(img, url, now) {
    var run = function () {
      active++;
      return getBlobURL(url).then(function (u) { return setSrc(img, u); })
        .catch(function () { return setSrc(img, url).catch(function () { return setSrc(img, url + "?r2=" + Date.now()); }); }) /* direct fallback, then one more retry */
        .then(function () { show(img); }, function () { img.parentNode && img.parentNode.classList.add("bad"); })
        .then(function () { active--; pump(); });
    };
    if (now || blobCache[url]) { if (blobCache[url]) setSrc(img, blobCache[url]).then(function () { show(img); }, function () {}); else run(); return; }
    queue.push({ img: img, url: url, pri: +img.dataset.pri || 0, run: run }); pump();
  }
  function pump() {
    queue.sort(function (a, b) { return a.pri - b.pri; });
    while (active < MAXC && queue.length) { var j = queue.shift(); if (j.img.isConnected) j.run(); }
  }
  function queueImg(img) { loadImg(img, img.dataset.src); }

  /* ---------- save to Shared Faves via webhook ---------- */
  var SAVING_STORE = "hh.saving.v1";
  function savingMap() { try { return JSON.parse(localStorage.getItem(SAVING_STORE) || "{}"); } catch (e) { return {}; } }
  function savingAt(z) { var m = savingMap(); return m[z] && Date.now() - m[z] < 24 * 3600 * 1000 ? m[z] : 0; }
  function isSavedHome(item) {
    var all = (state.alerts && state.alerts.items) || [];
    return all.some(function (i) { return String(i.zpid) === String(item.zpid) && (i.saved || i.savedAt || i.onFaves); });
  }
  function saveHome(item, b) {
    if (!hookCfg()) { openSettings(true); return; }
    b.disabled = true; b.lastChild.textContent = "Saving…";
    postHook({ action: "save", zpid: String(item.zpid), address: item.address + ", " + item.city, url: item.url }).then(function () {
      var m = savingMap(); m[item.zpid] = Date.now(); localStorage.setItem(SAVING_STORE, JSON.stringify(m));
    }, function (e) { b.disabled = false; b.lastChild.textContent = "Save"; toast(hookErr(e)); });
  }

  /* ---------- dismiss (per device) ---------- */
  var cardId = function (i) { return [i.zpid, i.kind, i.date || ""].join("|"); };
  function getDismissed() { try { return JSON.parse(localStorage.getItem(DISMISS_STORE) || "[]"); } catch (e) { return []; } }
  function setDismissed(a) { localStorage.setItem(DISMISS_STORE, JSON.stringify(a.slice(-300))); }
  function dismissCard(id, el) {
    var d = getDismissed(); if (d.indexOf(id) < 0) d.push(id); setDismissed(d);
    var done = function () { renderAlerts(); };
    if (el) { el.classList.add("gone"); setTimeout(done, 260); } else done();
    toast("Dismissed", "Undo", function () { setDismissed(getDismissed().filter(function (x) { return x !== id; })); renderAlerts(); });
  }
  function bindSwipe(card) {
    var hb = $(".hb", card), x0 = null, y0 = null, dx = 0, lock = null;
    hb.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null; card.style.transition = "none"; }, { passive: true });
    hb.addEventListener("touchmove", function (e) {
      if (x0 == null) return; var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (lock == null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) lock = Math.abs(mx) > Math.abs(my) * 1.4 ? "x" : "y";
      if (lock !== "x") return; dx = Math.min(0, mx); card.style.transform = "translateX(" + dx + "px)"; card.style.opacity = String(1 - Math.min(.6, -dx / 400));
    }, { passive: true });
    hb.addEventListener("touchend", function () {
      card.style.transition = ""; if (x0 == null) return; x0 = null;
      if (lock === "x" && dx < -110) { card.style.transform = "translateX(-110%)"; card.style.opacity = "0"; setTimeout(function () { dismissCard(card.dataset.id); }, 200); }
      else { card.style.transform = ""; card.style.opacity = ""; }
    }, { passive: true });
  }

  /* ---------- alerts tab ---------- */
  function carousel(item) {
    var photos = (item.photos || []).map(function (p) { return typeof p === "string" ? { url: p } : p; }).filter(function (p) { return p && p.url; }).slice(0, 8);
    var badge = item.kind === "drop" ? '<span class="badge drop">PRICE DROP</span>' : item.kind === "status" ? '<span class="badge status">' + esc((item.newStatus || "Status change").toUpperCase()) + "</span>" : '<span class="badge new">NEW</span>';
    var x = '<button class="dismissX" type="button" aria-label="Dismiss" data-dismiss>✕</button>';
    if (!photos.length) return '<div class="car">' + badge + x + "</div>";
    return '<div class="car" data-car>' + badge + x + '<span class="count">1 / ' + photos.length + "</span>" +
      '<div class="carTrack">' + photos.map(function (p, i) { return '<div class="ph"><img alt="' + esc(p.label || "Photo " + (i + 1)) + " · " + esc(item.address) + '" data-src="' + esc(cardSize(p.url)) + '" data-full="' + esc(fullSize(p.url)) + '" data-label="' + esc(p.label || "") + '" data-pri="' + (i === 0 ? 0 : i === 1 ? 1 : 2) + '" data-i="' + i + '" draggable="false">' + (p.label ? '<span class="phLabel">' + esc(p.label) + "</span>" : "") + "</div>"; }).join("") + "</div>" +
      (photos.length > 1 ? '<button class="arrow left" type="button" aria-label="Previous photo" disabled>‹</button><button class="arrow right" type="button" aria-label="Next photo">›</button><div class="dots">' + photos.map(function (_, i) { return "<i" + (i === 0 ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" : "") + "</div>";
  }
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function homeCard(item) {
    var prow = '<span class="price">' + money(item.price) + "</span>";
    if (item.kind === "drop" && item.oldPrice) {
      var diff = item.oldPrice - item.price, pct = diff / item.oldPrice * 100;
      prow += '<span class="was">' + money(item.oldPrice) + '</span><span class="pill red">▼ ' + money(diff) + " · " + pct.toFixed(1) + "%</span>";
    } else if (item.kind === "status") {
      prow += '<span class="pill amber">' + esc(item.oldStatus || "For sale") + " → " + esc(item.newStatus) + "</span>";
    } else if (item.kind === "new") {
      prow += '<span class="pill green">Just listed</span>';
    }
    var tiles = [["Beds", item.beds], ["Baths", item.baths], ["Sq ft", item.sqft ? Number(item.sqft).toLocaleString() : "—"], ["Acres", item.acres]]
      .map(function (t) { return '<div class="tile"><b>' + esc(t[1] == null ? "—" : t[1]) + "</b><span>" + t[0] + "</span></div>"; }).join("");
    var ppsf = item.ppsf || (item.price && item.sqft ? Math.round(item.price / item.sqft) : null);
    var facts = [["Built", [item.built, item.style].filter(Boolean).join(" · ")], ["HOA", item.hoa], ["Per sq ft", ppsf ? money(ppsf) : ""], ["On Zillow", item.dom != null ? item.dom + " days" : ""]]
      .filter(function (f) { return f[1]; }).map(function (f) { return '<div class="fact' + (f[0] === "Built" && String(f[1]).length > 16 ? " full" : "") + '"><span>' + f[0] + "</span><b>" + esc(f[1]) + "</b></div>"; }).join("");
    var hist = "", h = item.history || [];
    if (h.length >= 2) {
      var orig = h[0].price, last = h[h.length - 1].price;
      var note = last < orig ? money(orig - last) + " (" + ((orig - last) / orig * 100).toFixed(1) + "%) below original" : "";
      hist = '<div class="hist"><div class="histH"><span>Price history</span><em>' + esc(note) + '</em></div><div class="track"><div class="line"></div>' +
        h.map(function (x, i) { var cls = i === h.length - 1 ? (item.kind === "status" ? " pend" : " now") : ""; return '<div class="step' + cls + '"><div class="d"></div><div class="sp">' + (x.label ? esc(x.label) : short$(x.price)) + '</div><div class="sd">' + esc(x.date) + "</div></div>"; }).join("") + "</div></div>";
    }
    var saved = isSavedHome(item), pending = !saved && savingAt(item.zpid);
    var saveBtn = saved ? btn(item.url, "Open in Zillow", IC.z, true)
      : '<button class="btn primary saveBtn" type="button" data-save="' + esc(item.zpid) + '"' + (pending ? " disabled" : "") + ">" + IC.heart + "<span>" + (pending ? "Saving…" : "Save") + "</span></button>";
    return '<article class="card home" data-id="' + esc(cardId(item)) + '">' + carousel(item) + '<div class="hb"><div class="date">' + esc(item.headline || "") + (item.headline ? " · " : "") + esc(fmtDate(item.date)) + "</div>" +
      '<div class="addr">' + esc(item.address) + '</div><div class="city">' + esc(item.city) + (item.area ? " · " + esc(item.area) : "") + "</div>" +
      '<div class="prow">' + prow + '</div><div class="tiles">' + tiles + '</div><div class="facts">' + facts + "</div>" + hist +
      (item.note ? '<div class="note">' + esc(item.note) + "</div>" : "") +
      '<div class="btns">' + saveBtn + btn(mapsSearch(item.address + ", " + item.city), "Navigate", IC.nav) + "</div></div></article>";
  }
  function renderAlerts() {
    var el = $("#tab-alerts"), allItems = ((state.alerts && state.alerts.items) || []).slice();
    var dis = getDismissed(), hidden = allItems.filter(function (i) { return dis.indexOf(cardId(i)) >= 0; });
    var items = state.showDismissed ? allItems : allItems.filter(function (i) { return dis.indexOf(cardId(i)) < 0; });
    items.sort(function (x, y) { return (y.date || "").localeCompare(x.date || ""); });
    var al = items.filter(function (i) { return i.kind !== "new"; }), nw = items.filter(function (i) { return i.kind === "new"; });
    var f = state.filter;
    var chip = function (k, label, n) { return '<button class="chip' + (f === k ? " on" : "") + '" data-f="' + k + '">' + label + "<b>" + n + "</b></button>"; };
    var html = '<div class="chips">' + chip("all", "All", items.length) + chip("alerts", "Alerts", al.length) + chip("new", "New", nw.length) + "</div>";
    if (f !== "new") html += '<div class="secHead"><h2>Alerts</h2></div>' + (al.length ? '<div class="stack alertsGrid">' + al.map(homeCard).join("") + "</div>" : '<div class="card empty">None yet</div>');
    if (f !== "alerts") html += '<div class="secHead"><h2>New listings</h2></div>' + (nw.length ? '<div class="stack alertsGrid">' + nw.map(homeCard).join("") + "</div>" : '<div class="card empty">None yet</div>');
    if (hidden.length) html += '<p class="updated"><button class="linkBtn" id="showDis" type="button">' + (state.showDismissed ? "Hide dismissed" : "Show dismissed (" + hidden.length + ")") + "</button>" + (state.showDismissed ? ' · <button class="linkBtn" id="restoreDis" type="button">Restore all</button>' : "") + "</p>";
    if (state.alerts && state.alerts.updated) html += '<p class="updated">Updated ' + esc(new Date(state.alerts.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + "</p>";
    el.innerHTML = html;
    $$("[data-f]", el).forEach(function (b) { b.onclick = function () { state.filter = b.dataset.f; localStorage.setItem(FILTER_STORE, state.filter); renderAlerts(); }; });
    $$("[data-car]", el).forEach(function (c, ci) { bindCarousel(c); });
    $$("article.home", el).forEach(function (card) {
      var id = card.dataset.id, isDis = dis.indexOf(id) >= 0;
      if (isDis) { card.classList.add("dismissed"); $$("[data-dismiss]", card).forEach(function (b) { b.textContent = b.classList.contains("dismissX") ? "↺" : "Restore"; b.setAttribute("aria-label", "Restore"); }); }
      $$("[data-dismiss]", card).forEach(function (b) { b.onclick = function (e) { e.stopPropagation();
        if (isDis) { setDismissed(getDismissed().filter(function (x) { return x !== id; })); renderAlerts(); toast("Restored"); } else dismissCard(id, card); }; });
      if (!isDis) bindSwipe(card);
    });
    $$("[data-save]", el).forEach(function (b) { b.onclick = function () { var it = allItems.filter(function (i) { return String(i.zpid) === b.dataset.save; })[0]; if (it) saveHome(it, b); }; });
    var sd = $("#showDis", el); if (sd) sd.onclick = function () { state.showDismissed = !state.showDismissed; renderAlerts(); };
    var rd = $("#restoreDis", el); if (rd) rd.onclick = function () { setDismissed([]); state.showDismissed = false; renderAlerts(); toast("Restored all"); };
    var newest = items.length ? items.map(function (i) { return i.date || ""; }).sort().pop() : "";
    if (state.tab === "alerts") localStorage.setItem(SEEN_STORE, newest);
    $("#alertDot").hidden = !(newest && newest > (localStorage.getItem(SEEN_STORE) || ""));
  }
  function bindCarousel(c) {
    var track = $(".carTrack", c), dots = $$(".dots i", c), count = $(".count", c), prev = $(".arrow.left", c), next = $(".arrow.right", c);
    var n = $$("img", track).length;
    var idx = function () { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); };
    var upd = function () { var i = idx(); dots.forEach(function (d, j) { d.classList.toggle("on", j === i); }); if (count) count.textContent = (i + 1) + " / " + n; if (prev) prev.disabled = i <= 0; if (next) next.disabled = i >= n - 1; };
    var go = function (d) { track.scrollTo({ left: (idx() + d) * track.clientWidth, behavior: "smooth" }); };
    track.addEventListener("scroll", function () { cancelAnimationFrame(c._r); c._r = requestAnimationFrame(upd); }, { passive: true });
    if (prev) prev.onclick = function (e) { e.stopPropagation(); go(-1); };
    if (next) next.onclick = function (e) { e.stopPropagation(); go(1); };
    var srcs = $$("img", track).map(function (i) { return { url: i.dataset.full, label: i.dataset.label }; });
    $$("img", track).forEach(function (img) {
      img.addEventListener("click", function () { openViewer(srcs, +img.dataset.i); });
      queueImg(img);
    });
  }

  /* ---------- full-screen viewer ---------- */
  var V = { el: $("#viewer"), track: $("#vTrack"), n: 0 };
  function vIdx() { return Math.round(V.track.scrollLeft / Math.max(1, V.track.clientWidth)); }
  function vUpd() { var i = vIdx(); $("#vCount").textContent = (i + 1) + " / " + V.n; $("#vPrev").disabled = i <= 0; $("#vNext").disabled = i >= V.n - 1; }
  function openViewer(srcs, start) {
    V.n = srcs.length;
    V.track.innerHTML = srcs.map(function (s, i) { return '<div class="ph"><img data-src="' + esc(s.url) + '" alt="' + esc(s.label || "Photo " + (i + 1)) + '" draggable="false">' + (s.label ? '<span class="phLabel v">' + esc(s.label) + "</span>" : "") + "</div>"; }).join("");
    $$("img", V.track).forEach(function (img) { loadImg(img, img.dataset.src, true); });
    V.el.hidden = false; document.body.style.overflow = "hidden";
    requestAnimationFrame(function () { V.track.scrollLeft = start * V.track.clientWidth; vUpd(); });
  }
  function closeViewer() { V.el.hidden = true; V.track.innerHTML = ""; document.body.style.overflow = ""; }
  V.track.addEventListener("scroll", function () { requestAnimationFrame(vUpd); }, { passive: true });
  $("#vClose").onclick = closeViewer;
  $("#vPrev").onclick = function () { V.track.scrollTo({ left: (vIdx() - 1) * V.track.clientWidth, behavior: "smooth" }); };
  $("#vNext").onclick = function () { V.track.scrollTo({ left: (vIdx() + 1) * V.track.clientWidth, behavior: "smooth" }); };
  document.addEventListener("keydown", function (e) {
    if (V.el.hidden) return;
    if (e.key === "Escape") closeViewer(); else if (e.key === "ArrowRight") $("#vNext").click(); else if (e.key === "ArrowLeft") $("#vPrev").click();
  });
  (function () { var y0 = null, x0 = null; V.track.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
    V.track.addEventListener("touchend", function (e) { if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0, dx = e.changedTouches[0].clientX - x0; if (dy > 110 && Math.abs(dx) < 60) closeViewer(); y0 = null; }, { passive: true }); })();

  /* ---------- shell ---------- */
  function setTab(t) {
    state.tab = t; localStorage.setItem(TAB_STORE, t);
    $$(".tabBtn").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    $("#tab-showings").hidden = t !== "showings"; $("#tab-alerts").hidden = t !== "alerts";
    $("#title").textContent = t === "showings" ? "Showings" : "Alerts & New";
    $("#eyebrow").textContent = "House Hunter";
    if (t === "alerts") { var nw = (state.alerts && state.alerts.items || []).map(function (i) { return i.date || ""; }).sort().pop() || ""; localStorage.setItem(SEEN_STORE, nw); $("#alertDot").hidden = true; }
    window.scrollTo({ top: 0 });
  }
  function render() { renderShowings(); renderAlerts(); }
  $$(".tabBtn").forEach(function (b) { b.onclick = function () { if (state.tab === b.dataset.tab) window.scrollTo({ top: 0, behavior: "smooth" }); else setTab(b.dataset.tab); }; });
  $("#refreshBtn").onclick = function () { loadAll(true); };
  var sheet = $("#sheet");
  $("#settingsBtn").onclick = function () {
    $("#lockBtn").disabled = !localStorage.getItem(KEY_STORE);
    var u = state.enc && state.enc.updated ? "Showings updated " + new Date(state.enc.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ". " : "";
    $("#aboutLine").textContent = u;
    var c = hookCfg(); $("#hookUrl").value = c ? c.url : ""; $("#hookKey").value = c ? c.key : ""; $("#hookStatus").textContent = c ? "Connected" : "";
    sheet.hidden = false;
  };
  $$("[data-close]", sheet).forEach(function (b) { b.onclick = function () { sheet.hidden = true; }; });
  $("#lockBtn").onclick = function () { localStorage.removeItem(KEY_STORE); state.showings = null; sheet.hidden = true; renderShowings(); setTab("showings"); toast("Locked on this device"); };
  $("#reloadBtn").onclick = function () { sheet.hidden = true; loadAll(true); };
  $("#hookSave").onclick = function () {
    var u = $("#hookUrl").value.trim(), k = $("#hookKey").value.trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "").trim();
    if (!/^https:\/\//.test(u) || !k) { $("#hookStatus").textContent = "Need https URL and key"; return; }
    localStorage.setItem(HOOK_STORE, JSON.stringify({ url: u, key: k })); $("#hookKey").value = k; $("#hookStatus").textContent = "Saved"; renderAlerts();
  };
  $("#hookClear").onclick = function () { localStorage.removeItem(HOOK_STORE); $("#hookUrl").value = ""; $("#hookKey").value = ""; $("#hookStatus").textContent = "Cleared"; };
  window.addEventListener("scroll", function () { $("#top").classList.toggle("scrolled", window.scrollY > 4); }, { passive: true });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") loadAll(false); });

  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).then(function (reg) {
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") reg.update(); });
      }).catch(function () {});
    });
  }
  setTab(state.tab);
  loadAll(false);
})();
