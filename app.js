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
  var state = { viewBy: {}, tab: localStorage.getItem(TAB_STORE) || "showings", view: localStorage.getItem(VIEW_STORE) || "stops",
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
  function loadAll(manual, quiet) {
    var b = $("#refreshBtn"); if (!quiet) b.classList.add("spin");
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
    if (navigator.onLine === false) return Promise.reject(new Error("offline"));
    /* The routine host accepts the POST but its response has no CORS headers, so the browser hides it (TypeError).
       The request still lands and starts the run, so a TypeError while online counts as sent. Only a readable 4xx/5xx or
       being offline is an error. */
    return fetch(c.url, { method: "POST", mode: "cors", credentials: "omit", keepalive: true, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key }, body: body })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r; },
            function () { if (navigator.onLine === false) throw new Error("offline"); return { ok: true, opaque: true }; });
  }
  function hookErr(e) { return e.message === "offline" ? "Offline" : e.message === "HTTP 401" || e.message === "HTTP 403" ? "Webhook key rejected" : "Webhook error (" + e.message + ")"; }
  function openSettings(focusHook) {
    $("#settingsBtn").onclick();
    if (focusHook) setTimeout(function () { $("#hookUrl").focus(); }, 250);
  }

  /* ---------- proposed days: on-device plan (reorder, move between days, change dates) + re-timing via OSRM ----------
     The server copy is data.proposals (one entry per proposed day). Edits live in localStorage (PLAN_STORE) until the
     server catches up (a debounced {action:"plan"} webhook POST makes the routine regenerate the same plan). */
  var PLAN_STORE = "hh.plan.v2";
  function fmtT(m) { m = Math.round(m) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ":" + String(mi).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM"); }
  function fmtS(m) { return fmtT(m).replace(/ (AM|PM)$/, ""); }
  function parseT(t) { var m = String(t || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i); if (!m) return null; var h = +m[1] % 12 + (m[3] && /pm/i.test(m[3]) ? 12 : 0); if (!m[3] && +m[1] === 12) h = 12; return h * 60 + +m[2]; }
  function durTxt(sec) { var m = Math.max(1, Math.round(sec / 60)), h = Math.floor(m / 60); return h ? h + " hr " + (m % 60) + " min" : m + " min"; }
  var ceil5 = function (m) { return Math.ceil(m / 5) * 5; };
  var ceil15 = function (m) { return Math.ceil(m / 15) * 15; };   /* ShowingTime only takes :00/:15/:30/:45 starts */
  function fullAddr(s) { return String(s.address).split(",")[0] + ", " + (s.cityFull || s.city + ", CO"); }
  function gm(points, way) { var q = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(points[0]) + "&destination=" + encodeURIComponent(points[points.length - 1]) + "&travelmode=driving"; return way && way.length ? q + "&waypoints=" + encodeURIComponent(way.join("|")) : q; }
  function merc(lat, lon, z) { var sc = 256 * Math.pow(2, z), r = lat * Math.PI / 180; return [(lon + 180) / 360 * sc, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * sc]; }
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var zps = function (d) { return d.showings.map(function (s) { return s.zpid; }); };
  function serverProps() {
    var d = state.showings || {};
    var ps = d.proposals || (d.proposed ? [Object.assign({}, d.proposed, { id: "p-" + d.proposed.date })] : []);
    return ps.filter(function (p) { return p && p.showings && p.showings.length; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  var propGen = function (ps) { return ps.map(function (d) { return d.date + "@" + d.generated; }).join("|"); };
  var zKey = function (ps) { return ps.reduce(function (a, d) { return a.concat(zps(d)); }, []).sort().join(); };
  function loadPlan(ps) {
    var o; try { o = JSON.parse(localStorage.getItem(PLAN_STORE) || "null"); } catch (e) { o = null; }
    if (!o) return null;
    if (o.gen === propGen(ps)) return o;
    if (o.zs === zKey(ps) && Date.now() - o.at < 3 * 3600 * 1000) return o;   /* server regenerated, same homes: keep my edits */
    localStorage.removeItem(PLAN_STORE); return null;
  }
  /* one proposed day, re-timed from OSRM legs (pure; tpl = server day used for map image / projection / home) */
  function computeDay(tpl, pd, pool) {
    var d = clone(tpl), st = pd.order.map(function (z) { return clone(pool[z]); }).filter(Boolean);
    d.date = pd.date; d.id = "p-" + pd.date; d.cartDate = pd.cartDate === undefined ? tpl.date : pd.cartDate; d.srcId = tpl.id;
    if (!pd.legs) { d.showings = st; return d; }
    var o = pd, per = d.minutesPerHome || 30, first = ceil15(d.firstStart || 600), t = first, names = ["Home"].concat(st.map(function (s) { return s.short; }), ["Home"]);
    var legMin = o.legs.map(function (l) { return ceil5(l.duration / 60); });
    st.forEach(function (s, i) {
      if (i) t = ceil15(t + per + legMin[i]);
      s.n = i + 1; s.startMin = t; s.endMin = t + per; s.time = fmtS(t) + "–" + fmtT(t + per);
      s.drive = durTxt(o.legs[i].duration) + " · " + (o.legs[i].distance / 1609.344).toFixed(1) + " mi from " + names[i];
    });
    var addrs = [d.homeAddr].concat(st.map(fullAddr), [d.homeAddr]);
    st.forEach(function (s, i) { s.nav = gm([addrs[i], addrs[i + 1]]); });
    var leave = first - legMin[0], back = st[st.length - 1].endMin + legMin[legMin.length - 1];
    var tot = o.legs.reduce(function (a, l) { return a + l.duration; }, 0);
    d.metrics = [{ value: fmtT(leave), label: "Leave home" }, { value: durTxt(tot), label: "Driving" }, { value: fmtT(back), label: "Back home" }];
    d.routeLinks = [{ title: "Full route", site: "Google Maps", href: gm([d.homeAddr, d.homeAddr], st.map(fullAddr)), mark: "★" }].concat(o.legs.map(function (l, i) {
      return { title: names[i] + " → " + names[i + 1], site: "Leave " + fmtT(i ? st[i - 1].endMin : leave), href: gm([addrs[i], addrs[i + 1]]), mark: i < st.length ? String(i + 1) : "H" };
    }));
    if (d.map) {
      var pr = d.map.proj;
      d.map.legs = o.legs.map(function (l, i) { return { path: l.path, label: durTxt(l.duration) + " · " + (l.distance / 1609.344).toFixed(1) + " mi", x: l.x, y: l.y, ret: i === o.legs.length - 1 }; });
      var hm = (d.map.stops || []).filter(function (m) { return m.id === "home"; })[0];
      if (hm) hm.time = "Leave " + fmtS(leave);
      if (pr) d.map.stops = (hm ? [hm] : []).concat(st.map(function (s) {
        var m = merc(s.lat, s.lon, pr.z), x = +((m[0] - pr.ox) * pr.f).toFixed(1), y = +((m[1] - pr.oy) * pr.f).toFixed(1), right = x < 410;
        return { id: s.zpid, n: s.n, name: s.short, time: fmtS(s.startMin), confirmed: false, x: x, y: y, lx: right ? x + 16 : x - 16, ly: y - 2, anchor: right ? "start" : "end" };
      }));
    }
    d.showings = st; d.edited = true;
    return d;
  }
  /* the proposed days as shown: server copy with any on-device plan applied */
  function planDays() {
    var ps = serverProps(), plan = loadPlan(ps);
    if (!plan) return ps.map(function (d) { var c = clone(d); c.cartDate = d.date; c.srcId = d.id; return c; });
    var pool = {}, tplOf = {}, byId = {};
    ps.forEach(function (d) { byId[d.id] = d; d.showings.forEach(function (s) { pool[s.zpid] = s; tplOf[s.zpid] = d; }); });
    return plan.days.map(function (pd) {
      pd.order = pd.order.filter(function (z) { return pool[z]; });
      if (!pd.order.length) return null;
      var tpl = byId[pd.src] || tplOf[pd.order[0]];
      if (!pd.legs && zps(tpl).join() !== pd.order.join()) pd = Object.assign({}, pd, { order: zps(tpl) });   /* never show stale times */
      return computeDay(tpl, pd, pool);
    }).filter(Boolean).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function osrmLegs(tpl, stops) {
    var pts = [tpl.homePt].concat(stops.map(function (s) { return [s.lat, s.lon]; }), [tpl.homePt]);
    var url = "https://router.project-osrm.org/route/v1/driving/" + pts.map(function (p) { return (+p[1]).toFixed(6) + "," + (+p[0]).toFixed(6); }).join(";") + "?overview=false&steps=true&geometries=geojson";
    return fetch(url).then(function (r) { return r.json(); }).then(function (R) {
      if (R.code !== "Ok") throw new Error(R.code);
      var pr = tpl.map && tpl.map.proj;
      return R.routes[0].legs.map(function (lg) {
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
    });
  }
  /* apply an edit: next = [{date, src, cartDate, order, legs?}] ; days whose order changed get fresh OSRM legs */
  function commitPlan(next, msg) {
    var ps = serverProps(), pool = {}, byId = {}, cur = {};
    ps.forEach(function (d) { byId[d.id] = d; d.showings.forEach(function (s) { pool[s.zpid] = s; }); });
    planDays().forEach(function (d) { cur[d.date] = d; });
    next = next.filter(function (pd) { return pd.order.length; });
    toast("Updating route…");
    return Promise.all(next.map(function (pd) {
      var tpl = byId[pd.src] || ps[0], was = cur[pd.date];
      var same = was && zps(was).join() === pd.order.join();
      if (same && was.edited === !!pd.legs) return pd;
      if (!pd.legs && zps(tpl).join() === pd.order.join()) return pd;
      return osrmLegs(tpl, pd.order.map(function (z) { return pool[z]; })).then(function (legs) { pd.legs = legs; return pd; });
    })).then(function (days) {
      var serverSame = days.length === ps.length && days.every(function (pd, i) {
        var s = ps.filter(function (p) { return p.date === pd.date; })[0]; return s && zps(s).join() === pd.order.join();
      });
      if (serverSame) localStorage.removeItem(PLAN_STORE);
      else localStorage.setItem(PLAN_STORE, JSON.stringify({ gen: propGen(ps), zs: zKey(ps), at: Date.now(), days: days }));
      renderShowings(); toast(msg || "Route updated");
      if (hookCfg()) queuePlanPost();
    }).catch(function () { toast("Couldn't update the route. Try again."); });
  }
  var planNow = function () { return planDays().map(function (d) { return { date: d.date, src: d.srcId, cartDate: d.cartDate, order: zps(d), legs: d.edited ? legsOf(d) : null }; }); };
  function legsOf(d) {   /* keep the legs of an already edited day */
    var o; try { o = JSON.parse(localStorage.getItem(PLAN_STORE) || "null"); } catch (e) {}
    var pd = o && o.days.filter(function (x) { return x.date === d.date; })[0];
    return pd && pd.legs && pd.order.join() === zps(d).join() ? pd.legs : null;
  }
  function reorderDay(date, order) {
    commitPlan(planNow().map(function (pd) { return pd.date === date ? Object.assign(pd, { order: order, legs: null }) : pd; }));
  }
  function moveStop(z, from, to) {
    var p = planNow(), src = p.filter(function (x) { return x.date === from; })[0];
    if (to === "new") {
      var last = p.map(function (x) { return x.date; }).sort().pop(), nd = new Date(last + "T12:00:00"); nd.setDate(nd.getDate() + 1);
      to = nd.getFullYear() + "-" + String(nd.getMonth() + 1).padStart(2, "0") + "-" + String(nd.getDate()).padStart(2, "0");
      while (p.some(function (x) { return x.date === to; })) { nd.setDate(nd.getDate() + 1); to = nd.toISOString().slice(0, 10); }
      p.push({ date: to, src: src.src, cartDate: null, order: [], legs: null });
    }
    p.forEach(function (x) {
      if (x.date === from) { x.order = x.order.filter(function (y) { return y !== z; }); x.legs = null; }
      if (x.date === to) { x.order = x.order.concat([z]); x.legs = null; }
    });
    commitPlan(p, "Moved to " + new Date(to + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
  }
  function setDayDate(old, nw) {
    if (!nw || nw === old) return;
    var p = planNow(), a = p.filter(function (x) { return x.date === old; })[0], b = p.filter(function (x) { return x.date === nw; })[0];
    if (b) { b.order = b.order.concat(a.order); b.legs = null; p = p.filter(function (x) { return x !== a; }); }
    else a.date = nw;
    var c = serverCartFor(a.cartDate);
    commitPlan(p, c && c.status === "in_cart" ? "Moved. Cart keeps the old date until you update it" : "Date changed");
  }
  function stopsPayload(d) { return d.showings.map(function (s) { return { zpid: s.zpid, address: fullAddr(s), start: fmtT(s.startMin), end: fmtT(s.endMin) }; }); }
  var planTimer = null;
  function queuePlanPost() {   /* one server run ~4 s after the last edit, not one per tap */
    clearTimeout(planTimer);
    planTimer = setTimeout(function () {
      state.planPosted = true;
      postHook({ action: "plan", days: planDays().map(function (d) { return { date: d.date, stops: stopsPayload(d) }; }) }).catch(function (e) { toast(hookErr(e)); });
    }, 4000);
  }
  function bindReorder(sec, day) {
    var list = $(".s2List", sec); if (!list) return;
    var cards = function () { return $$(".proposedStop", list); };
    var commit = function () { var o = cards().map(function (c) { return c.dataset.zpid; }); if (o.join() !== zps(day).join()) reorderDay(day.date, o); };
    $$(".s2Menu select", list).forEach(function (sel) { sel.onchange = function () {
      var v = sel.value, z = sel.dataset.zpid; sel.selectedIndex = 0;
      if (v === "up" || v === "down") { var o = zps(day), i = o.indexOf(z), j = v === "up" ? i - 1 : i + 1; if (j < 0 || j >= o.length) return; o.splice(i, 1); o.splice(j, 0, z); reorderDay(day.date, o); }
      else if (v) moveStop(z, day.date, v);
    }; });
    var skip = function (t) { return t.closest("a, button, select, label, details, input"); };
    cards().forEach(function (card) {
      var timer = null, drag = false, y0 = 0, x0 = 0;
      var begin = function () { drag = true; state.dragging = true; card.classList.add("dragging"); list.classList.add("sorting"); if (navigator.vibrate) navigator.vibrate(10); };
      var swap = function (a, b) { var t = document.createElement("i"); a.replaceWith(t); b.replaceWith(a); t.replaceWith(b); };
      var move = function (y) {
        card.style.transform = "translateY(" + (y - y0) + "px)";
        var cs = cards(), i = cs.indexOf(card), r = card.getBoundingClientRect(), cy = r.top + r.height / 2;
        var nb = cy < (cs[i - 1] ? cs[i - 1].getBoundingClientRect().top + cs[i - 1].offsetHeight / 2 : -1e9) ? cs[i - 1] :
                 cy > (cs[i + 1] ? cs[i + 1].getBoundingClientRect().top + cs[i + 1].offsetHeight / 2 : 1e9) ? cs[i + 1] : null;
        if (!nb) return;
        var before = card.offsetTop; swap(card, nb); y0 += card.offsetTop - before;
        card.style.transform = "translateY(" + (y - y0) + "px)";
      };
      var finish = function () {
        clearTimeout(timer); if (!drag) return; drag = false;
        card.style.transform = ""; card.classList.remove("dragging"); list.classList.remove("sorting");
        setTimeout(function () { state.dragging = false; }, 60); commit();
      };
      card.addEventListener("touchstart", function (e) { if (skip(e.target)) return; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; clearTimeout(timer); timer = setTimeout(begin, 380); }, { passive: true });
      card.addEventListener("touchmove", function (e) {
        var t = e.touches[0];
        if (!drag) { if (Math.abs(t.clientY - y0) > 8 || Math.abs(t.clientX - x0) > 8) clearTimeout(timer); return; }
        if (e.cancelable) e.preventDefault(); move(t.clientY);
      }, { passive: false });
      card.addEventListener("touchend", finish); card.addEventListener("touchcancel", finish);
      card.addEventListener("contextmenu", function (e) { if (drag || timer) e.preventDefault(); });
      card.addEventListener("mousedown", function (e) {
        if (e.button || skip(e.target) || "ontouchstart" in window) return;
        y0 = e.clientY; x0 = e.clientX; clearTimeout(timer); timer = setTimeout(begin, 380);
        var mm = function (ev) { if (!drag) { if (Math.abs(ev.clientY - y0) > 8 || Math.abs(ev.clientX - x0) > 8) clearTimeout(timer); return; } ev.preventDefault(); move(ev.clientY); };
        var mu = function () { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); finish(); };
        document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
      });
    });
  }


  /* ---------- ShowingTime cart, one tour per proposed day ----------
     server: data.carts[date] = {status: in_cart|sent|done, url, at, date, stops:[{zpid,start,end}]} (what is really in the cart).
     local markers (per cart date): pending send/update, undo, "I sent it". */
  var PEND_PREFIX = "hh.cartPend.", DONE_PREFIX = "hh.cartDone.", PEND_MAX = 10 * 60 * 1000;
  ["hh.cartSent.", "hh.cartUndo."].forEach(function (p) { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(p) === 0) localStorage.removeItem(k); }); });
  var CART_FALLBACK = "https://apptcenter.showingdesk.com";
  var mark = function (p, k) { try { var o = JSON.parse(localStorage.getItem(p + k) || "null"); if (!o || Date.now() - o.at > 6 * 3600 * 1000) return null; return o; } catch (e) { return null; } };
  var setMark = function (p, k) { localStorage.setItem(p + k, JSON.stringify({ at: Date.now() })); };
  function serverCartFor(date) { var c = date && (state.showings && state.showings.carts || {})[date]; return c && c.status ? c : null; }
  function serverSync(keys) { var y = keys.map(syncFor).filter(function (x) { return x && !x.failed && Date.now() - Date.parse(x.at) < PEND_MAX; })[0]; return y || null; }
  function anyServerSync() { var c = (state.showings && state.showings.cartSync) || {}; return Object.keys(c).some(function (k) { return serverSync([k]); }); }
  function syncFor(date) { return date && (state.showings && state.showings.cartSync || {})[date] || null; }
  /* what the routine has published for this cart: changes when it finishes (status/at/stops) */
  function cartSig(keys) { return keys.map(function (k) { var c = serverCartFor(k); return c ? [c.status, c.at, JSON.stringify(c.stops || [])].join("~") : "-"; }).join("|"); }
  var cartKeys = function (day) { return (day.cartDate && day.cartDate !== day.date ? [day.cartDate] : []).concat([day.date]); };
  var flips = {};
  function cartInfo(day) {
    var key = day.cartDate || null, sc = serverCartFor(key), keys = cartKeys(day), pk = key || day.date;
    var pend = mark(PEND_PREFIX, pk);
    if (pend) {
      var sy = keys.map(syncFor).filter(Boolean)[0], at = sy && Date.parse(sy.at);
      if (sy && sy.at === pend.syncAt) sy = null;   /* marker from before this tap */
      if (sy && sy.failed && at >= pend.at - 60000) pend.failed = true;
      else if (cartSig(keys) !== pend.base && !(sy && !sy.failed && at >= pend.at - 60000)) {
        localStorage.removeItem(PEND_PREFIX + pk); pend = null; flips[pk] = 1; if (navigator.vibrate) navigator.vibrate(12);
      } else pend.stale = Date.now() - pend.at > PEND_MAX;
    }
    var live = !pend && serverSync(keys);   /* the routine is working on this cart (started elsewhere): "Updating cart…" */
    if (live) pend = { at: Date.parse(live.at), action: live.action === "uncart" ? "uncart" : "update", server: true };
    var sent = (sc && (sc.status === "sent" || sc.status === "done")) || !!(key && mark(DONE_PREFIX, key));
    var dirty = false;
    if (sc && sc.status === "in_cart" && sc.stops) {
      var want = stopsPayload(day).map(function (x) { return x.zpid + "@" + parseT(x.start); }).sort().join();
      var have = sc.stops.map(function (x) { return x.zpid + "@" + parseT(x.start); }).sort().join();
      dirty = want !== have || (sc.date && sc.date !== day.date);
    }
    return { key: key, pk: pk, sc: sc, pend: pend, sent: sent, dirty: dirty, inCart: sc && sc.status === "in_cart" };
  }
  function startPend(day, action) {
    localStorage.setItem(PEND_PREFIX + (day.cartDate || day.date), JSON.stringify({ at: Date.now(), action: action, base: cartSig(cartKeys(day)), syncAt: (cartKeys(day).map(syncFor).filter(Boolean)[0] || {}).at || null }));
    renderShowings(); pollSoon();
  }
  function sendCart(day, b, action) {
    if (!hookCfg()) { openSettings(true); return; }
    var label = b.innerHTML; b.disabled = true;
    postHook({ action: "cart", date: day.date, cartDate: day.cartDate || undefined, stops: stopsPayload(day) }).then(function () { loadShowings().then(function () { startPend(day, action); }); },
      function (e) { b.disabled = false; b.innerHTML = label; toast(hookErr(e)); });
  }
  function cartAction(day, action, okMsg) {
    if (!hookCfg()) { openSettings(true); return; }
    var key = day.cartDate || day.date;
    postHook({ action: action, date: key }).then(function () {
      if (action === "uncart") { loadShowings().then(function () { startPend(day, "uncart"); }); return; }
      setMark(DONE_PREFIX, key); renderShowings(); toast(okMsg);
    }, function (e) { toast(hookErr(e)); });
  }
  function retryCart(day) {
    var p = mark(PEND_PREFIX, day.cartDate || day.date) || {}, b = $('.pday[data-date="' + day.date + '"] .cartBtn');
    localStorage.removeItem(PEND_PREFIX + (day.cartDate || day.date));
    if (p.action === "uncart") cartAction(day, "uncart"); else sendCart(day, b || document.createElement("button"), p.action || "cart");
  }
  var PEND_LABEL = { cart: "Adding to cart", update: "Updating cart", uncart: "Undoing cart" };
  var elapsed = function (at) { var t = Math.max(0, Math.floor((Date.now() - at) / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  function pendHTML(p) {
    if (p.failed || p.stale) return '<button class="btn primary cartBtn wait" type="button" disabled>' + (p.failed ? "Couldn’t update the cart" : "Still working, check back shortly") + "</button>" +
      '<div class="cartLinks"><button type="button" data-cart="retry">Retry</button></div>';
    return '<button class="btn primary cartBtn busy" type="button" disabled><i class="spin"></i>' + (PEND_LABEL[p.action] || PEND_LABEL.cart) + '… <span class="el" data-el="' + p.at + '">' + elapsed(p.at) + "</span></button>";
  }
  /* while a cart action is pending: poll the published data every 15 s, tick the elapsed time every second */
  function pendingKeys() { return Object.keys(localStorage).filter(function (k) { if (k.indexOf(PEND_PREFIX) !== 0) return false; var p = mark(PEND_PREFIX, k.slice(PEND_PREFIX.length)); return p && Date.now() - p.at <= PEND_MAX; }); }
  var pollT = null, tickT = null;
  function pollSoon() {
    clearTimeout(pollT); clearInterval(tickT);
    if (!pendingKeys().length && !anyServerSync()) return;
    tickT = setInterval(function () {
      var stale = false;
      $$("[data-el]").forEach(function (e) { var at = +e.dataset.el; if (Date.now() - at > PEND_MAX) stale = true; else e.textContent = elapsed(at); });
      if (stale) { renderShowings(); pollSoon(); }
    }, 1000);
    pollT = setTimeout(function () { loadAll(false, true).then(pollSoon, pollSoon); }, 15000);
  }

  /* ---------- ask the bot: copy a context line, open the Grok Bot chat ---------- */
  var BOT_LINK = "grokbot://app/v1/agent?id=043E5835-B7D1-439D-A1D5-DC8C2F83F1F1";
  var askBtn = function (zpid, street, town, big) {
    return '<button class="' + (big ? "btn ico" : "sb ico") + ' askBot" type="button" aria-label="Ask Grok Bot" data-z="' + esc(zpid || "") + '" data-a="' + esc(street || "") + '" data-c="' + esc(town || "") + '"><img src="icons/icon-180.png?v=6" alt="" draggable="false"></button>';
  };
  function askLine(z, street, town) {
    var hit = null, sched = (state.showings && state.showings.days) || [];
    var find = function (days, prop) { days.forEach(function (d) { (d.showings || []).forEach(function (s) { if (!hit && z && String(s.zpid) === String(z) && !(d.date && d.date < todayISO())) hit = { s: s, d: d, prop: prop }; }); }); };
    find(sched, false); find(planDays(), true);
    var info = "";
    if (hit) {
      var d = hit.d, s = hit.s, st;
      if (hit.prop) { var c = serverCartFor(d.cartDate || d.date); st = c && (c.status === "sent" || c.status === "done") ? "sent" : c && c.status === "in_cart" ? "in cart" : "proposed"; }
      else st = s.confirmed === false ? "requested" : isSeen(s, d) ? "seen" : "confirmed";
      var t = s.startMin != null ? fmtT(s.startMin) : String(s.time || "").replace(/[–-].*?(\s?[AP]M)$/, "$1");
      var when = d.date ? new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "") : "";
      info = " (" + [when, t].filter(Boolean).join(" ") + " showing, " + st + ")";
    }
    return "About " + street + (town ? ", " + town : "") + info + ": ";
  }
  function copyText(t) {
    try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t); } catch (e) {}
    var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;opacity:0;top:0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); return Promise.resolve();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".askBot"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var go = function () { toast("Copied"); setTimeout(function () { location.href = BOT_LINK; }, 650); };
    copyText(askLine(b.dataset.z, b.dataset.a, b.dataset.c)).then(go, go);
  }, true);

  /* ---------- showings tab ---------- */
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function isPast(day) { return day.status === "Completed" || (!!day.date && day.date < todayISO()); }
  function dayGroups() {
    var d = state.showings || {}, all = d.days || [];
    var upcoming = all.filter(function (x) { return !isPast(x); }).sort(function (x, y) { return (x.date || "").localeCompare(y.date || ""); });
    var past = all.filter(isPast).sort(function (x, y) { return (y.date || "").localeCompare(x.date || ""); });
    return { upcoming: upcoming, past: past, proposed: planDays() };
  }
  function findDay(id) {
    var g = dayGroups();
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
  function head(s, timeLine, right, noType) {
    return '<div class="sHead">' + thumb(s) + '<div class="sMain">' + (timeLine ? '<div class="sTime">' + timeLine + "</div>" : "") +
      '<div class="sAddr">' + esc(s.address) + '</div><div class="sBasics">' + esc(basics(s, !timeLine)) + (noType ? "" : typeTag(s)) + "</div></div>" +
      '<div class="sRight">' + (s.price ? '<b>' + short$(s.price) + "</b>" : "") + (right || "") + "</div></div>";
  }
  /* showType: go_and_show | appt (older data: accessType text) -> tiny tag next to the basics */
  function showTypeOf(s) { var v = String(s.showType || s.accessType || "").toLowerCase(); return /go/.test(v) && /show/.test(v) ? "go_and_show" : /appt|appointment/.test(v) ? "appt" : ""; }
  var typeTag = function (s) { var t = showTypeOf(s); return t ? ' <span class="tTag' + (t === "appt" ? " appt" : "") + '">' + (t === "appt" ? "Appt" : "Go &amp; Show") + "</span>" : ""; };
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
  /* ---------- stop cards: hero photo, number + time on the photo, address + price, stats + type tag, slim actions ---------- */
  var dLabel = function (iso) { return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  var sb = function (href, label, icon, primary, ext) {
    if (!href) return "";
    var x = ext === false ? "" : /^https?:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return '<a class="sb' + (primary ? " pri" : "") + (label ? "" : " ico") + '" href="' + esc(href) + '"' + x + (label ? "" : ' aria-label="Zillow"') + ">" + icon + (label ? "<span>" + esc(label) + "</span>" : "") + "</a>";
  };
  var DOTS = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';
  var askS = function (s) { var p = String(s.address || "").split(","); return askBtn(s.zpid, p[0], s.city || (p[1] || "").trim()); };
  function card2(s, o) {
    var street = String(s.address || "").split(",")[0], town = s.city || String(s.address || "").split(",")[1] || "";
    var stats = [String(town).trim(), basics(s, o.built)].filter(Boolean).join(" · ");
    var img = s.photo ? '<img class="s2Img" data-src="' + esc(cardSize(s.photo)) + '" data-pri="0" alt="" draggable="false">' : '<div class="s2None">' + HOUSE + "</div>";
    var when = o.time ? '<span class="s2When"><b' + (o.green ? ' class="g"' : "") + ">" + esc(s.n) + "</b>" + esc(o.time) + "</span>" : "";
    return '<article class="card stop2' + (o.cls ? " " + o.cls : "") + '" data-zpid="' + esc(s.zpid || s.address) + '">' +
      '<div class="s2Hero">' + img + '<div class="s2Over">' + when + (o.pills || "") + "</div>" + (o.menu || "") + (o.noType ? "" : '<div class="s2Type">' + typeTag(s) + "</div>") + "</div>" +
      '<div class="s2Body"><div class="s2Line"><span class="s2Addr">' + esc(street) + "</span>" + (s.price ? '<b class="s2Price">' + short$(s.price) + "</b>" : "") + "</div>" +
      '<div class="s2Stats">' + esc(stats) + "</div>" + (o.extra || "") +
      (o.actions ? '<div class="s2Act">' + o.actions + "</div>" : "") + "</div></article>";
  }
  var legTxt = function (t) { return String(t || "").replace(/ · [\d.]+ mi/, "").replace(/ from .*/, ""); };
  function leg(s, i) {
    var t = legTxt(s.drive || s.navFrom); if (!t) return "";
    return '<div class="s2Leg">' + (i === 0 ? '<span class="lh">' + HOUSE + "</span>" : "<i></i>") + "<span>" + esc(t) + "</span></div>";
  }
  function seenStopCard(s) {
    var pill = s.feedbackDone ? '<span class="s2Pill green">Feedback sent</span>' : '<span class="s2Pill">Seen</span>';
    var fb = s.feedbackUrl && !s.feedbackDone ? sb(s.feedbackUrl, "Leave feedback", IC.doc, true) : "";
    return card2(s, { cls: "seen", pills: pill, noType: true, built: true, extra: take(s) + accessInfo(s), actions: fb + sb(s.zillow, fb ? "" : "Zillow", IC.z) + askS(s) });
  }
  function proposedStopCard(s, day, ctx) {
    ctx = ctx || {};
    var ct = "";
    if (ctx.cart && ctx.cart.inCart && ctx.cart.sc.stops) {   /* plan vs cart, only where they differ */
      var c = ctx.cart.sc.stops.filter(function (x) { return String(x.zpid) === String(s.zpid); })[0];
      ct = !c ? '<span class="s2Pill">Not in cart</span>' : parseT(c.start) !== s.startMin ? '<span class="s2Pill">Cart ' + esc(fmtS(parseT(c.start))) + "</span>" : "";
    }
    var acts = sb(s.nav, "Navigate", IC.nav, true) + sb(s.zillow, "", IC.z) + askS(s);
    if (ctx.locked) return card2(s, { time: s.time, pills: '<span class="s2Pill amber">Requested</span>', actions: acts });
    var zo = zps(day).map(String), zi = zo.indexOf(String(s.zpid));
    var opts = (zi > 0 ? '<option value="up">Move up</option>' : "") + (zi > -1 && zi < zo.length - 1 ? '<option value="down">Move down</option>' : "") +
      (ctx.others || []).map(function (d) { return '<option value="' + esc(d) + '">Move to ' + esc(dLabel(d)) + "</option>"; }).join("") + '<option value="new">Move to new day</option>';
    var menu = '<label class="s2Menu" aria-label="Options">' + DOTS + '<select data-zpid="' + esc(s.zpid) + '"><option value="" disabled selected>Options</option>' + opts + "</select></label>";
    return card2(s, { cls: "proposedStop", time: s.time, pills: ct, menu: menu, actions: acts });
  }
  function stopCard(s, day, ctx) {
    if (s.proposed) return proposedStopCard(s, day, ctx);
    if (isSeen(s, day)) return seenStopCard(s);
    var isDoor = /door/i.test(s.code || ""), code = String(s.code || "").replace(/\s*\(door code\)/i, "");
    var tel = s.phone ? "tel:" + String(s.phone).replace(/[^0-9+]/g, "") : "";
    var pend = s.confirmed === false;
    var extra = (code ? '<div class="codeRow"><span>' + (isDoor ? "Door code" : "Lockbox") + '</span><b>' + esc(code) + "</b></div>" : "") +
      (s.flag ? '<div class="flag">' + esc(s.flag) + "</div>" : "") + (s.instructions ? '<div class="door">' + esc(s.instructions) + "</div>" : "") + take(s);
    return card2(s, { time: s.time, green: !pend, pills: pend ? '<span class="s2Pill amber">Requested</span>' : "", extra: extra,
      actions: sb(s.nav, "Navigate", IC.nav, true) + sb(tel, "Call", IC.call, false, false) + sb(s.confirmUrl, "Edit", IC.doc) + sb(s.feedbackUrl, "Feedback", IC.doc) + sb(s.zillow, "", IC.z) + askS(s) });
  }
  function stopsHTML(day, ctx) {
    return '<div class="stack s2List">' + day.showings.map(function (s, i) {
      var seen = !s.proposed && isSeen(s, day);
      return (seen ? "" : leg(s, i)) + stopCard(s, day, ctx);
    }).join("") + "</div>";
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
  function dayView(day, ctx) {
    ctx = ctx || {};
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
    var vkey = prop ? "p" + day.date : "d", cur = prop ? (state.viewBy[vkey] || "stops") : state.view;
    var views = [["stops", "Stops"]].concat(allSeen ? [] : [["map", "Route"]], [["compare", "Compare"]], prop || allSeen ? [] : [["details", "Details"]]);
    var view = views.some(function (v) { return v[0] === cur; }) ? cur : "stops";
    var ci = prop ? cartInfo(day) : null, locked = !!(ci && ci.sent);
    var body = "";
    if (view === "map") body = routeHTML(day);
    else if (view === "compare") body = compareHTML(day);
    else if (view === "details") body = detailsHTML(day);
    else body = stopsHTML(day, { others: ctx.others, cart: ci, locked: locked });
    var badge = prop ? (locked ? '<span class="tag amber">Sent</span>' : ci.inCart ? '<span class="tag amber">In cart</span>' : '<span class="tag amber">Proposed</span>') : past || allSeen ? '<span class="tag">Done</span>' : "";
    var cart = "";
    if (prop && !locked) {
      var sc = ci.sc, review = '<a class="btn primary cartBtn" href="' + esc((sc && sc.url) || CART_FALLBACK) + '" target="_blank" rel="noopener noreferrer">Review cart</a>';
      var fl = flips[ci.pk] ? " flip" : ""; delete flips[ci.pk];
      if (ci.pend) cart = pendHTML(ci.pend);
      else if (ci.inCart && ci.dirty) cart = '<button class="btn primary cartBtn' + fl + '" data-cart="update" type="button">Update cart</button>';
      else if (ci.inCart) cart = review.replace("cartBtn", "cartBtn" + fl);
      else cart = '<button class="btn primary cartBtn' + fl + '" data-cart="send" type="button">Send to ShowingTime cart</button>';
      if (ci.inCart && !ci.pend) cart += '<div class="cartLinks">' + (ci.dirty ? '<a href="' + esc((sc && sc.url) || CART_FALLBACK) + '" target="_blank" rel="noopener noreferrer">Review</a>' : "") +
        '<button type="button" data-cart="sent">I sent it</button><button type="button" data-cart="uncart">Undo cart</button></div>';
    }
    if (prop && day.edited && !locked && ctx.single) cart += '<button class="resetOrder" data-reset type="button">Reset</button>';
    var title = prop ? dLabel(day.date) : day.label || day.title;
    var titleHTML = prop && !locked ? '<label class="dateEdit">' + esc(title) + '<i>▾</i><input type="date" value="' + esc(day.date) + '" min="' + todayISO() + '" aria-label="Change date"></label>' : esc(title);
    return '<section class="pday" data-date="' + esc(day.date || "") + '"><div class="card dayCard' + (prop ? " proposed" : "") + '"><div class="dayTop"><div class="dayTitle">' + titleHTML + "</div>" + badge + '</div><div class="metrics">' + metrics + "</div>" + cart + "</div>" +
      '<div class="seg" role="tablist" style="margin-top:12px">' + views.map(function (v) { return '<button data-view="' + v[0] + '" data-vkey="' + vkey + '" class="' + (view === v[0] ? "on" : "") + '">' + v[1] + "</button>"; }).join("") + "</div>" + body + "</section>";
  }
  function planHTML(days) {
    var dates = days.map(function (d) { return d.date; });
    var anyEdit = days.some(function (d) { return d.edited; }) || !!localStorage.getItem(PLAN_STORE);
    return days.map(function (d) { return dayView(d, { others: dates.filter(function (x) { return x !== d.date; }) }); }).join('<div class="dayGap"></div>') +
      (anyEdit ? '<button class="resetOrder planReset" data-reset type="button">Reset to suggested plan</button>' : "");
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
    var open = state.dayId && state.dayId !== "plan" ? findDay(state.dayId) : null;
    if (open && isPast(open)) {
      html = '<button class="backLink" id="backBtn">‹ Showings</button>' + dayView(open);
    } else {
      var active = g.upcoming.slice(), hasPlan = g.proposed.length > 0;
      if (!active.length && !hasPlan) html = emptyHTML();
      else {
        var cur = open && active.indexOf(open) >= 0 ? open : state.dayId === "plan" && hasPlan ? "plan" : active[0] || "plan";
        var chips = active.length && hasPlan || active.length > 1 ? '<div class="dayChips">' + active.map(function (d) { return '<button class="chip' + (d === cur ? " on" : "") + '" data-day="' + esc(d.id) + '">' + esc(d.label || d.date) + "</button>"; }).join("") +
          (hasPlan ? '<button class="chip prop' + (cur === "plan" ? " on" : "") + '" data-day="plan">Plan</button>' : "") + "</div>" : "";
        html = chips + (cur === "plan" ? planHTML(g.proposed) : dayView(cur));
      }
      html += pastHTML(g.past);
    }
    el.innerHTML = html;
    $$("[data-view]", el).forEach(function (b) { b.onclick = function () {
      if (b.dataset.vkey === "d") { state.view = b.dataset.view; localStorage.setItem(VIEW_STORE, state.view); } else state.viewBy[b.dataset.vkey] = b.dataset.view;
      var sec = b.closest(".pday"), top = sec ? sec.getBoundingClientRect().top + window.scrollY - 70 : 0;
      renderShowings(); window.scrollTo({ top: Math.max(0, top) }); }; });
    $$("[data-day]", el).forEach(function (b) { b.onclick = function () { state.dayId = b.dataset.day; renderShowings(); window.scrollTo({ top: 0 }); }; });
    var bk = $("#backBtn", el); if (bk) bk.onclick = function () { state.dayId = null; renderShowings(); window.scrollTo({ top: 0 }); };
    var pd = $("details.past", el); if (pd) pd.addEventListener("toggle", function () { state.pastOpen = pd.open; });
    $$(".thumb img, .s2Img", el).forEach(queueImg);
    var days = {}; g.proposed.forEach(function (d) { days[d.date] = d; });
    $$(".pday", el).forEach(function (sec) {
      var day = days[sec.dataset.date]; if (!day) return;
      $$("[data-cart]", sec).forEach(function (b) { b.onclick = function () {
        var k = b.dataset.cart;
        if (k === "send" || k === "update") sendCart(day, b, k === "update" ? "update" : "cart");
        else if (k === "retry") retryCart(day);
        else if (k === "sent") cartAction(day, "cart_sent", "Marked as sent");
        else if (k === "uncart") cartAction(day, "uncart", "Cart undone");
      }; });
      var di = $(".dateEdit input", sec); if (di) di.onchange = function () { setDayDate(day.date, di.value); };
      if ($(".proposedStop", sec)) bindReorder(sec, day);
    });
    $$(".stop2", el).forEach(function (c) { c.onclick = function (e) {
      if (state.dragging || e.target.closest("a, button, select, label, details, input, .codeRow")) return;
      var hit = stopByZ(c.dataset.zpid); if (hit) openDetail(hit, true); }; });
    $$("[data-reset]", el).forEach(function (b) { b.onclick = function () { clearTimeout(planTimer); localStorage.removeItem(PLAN_STORE); renderShowings(); if (hookCfg() && state.planPosted) queuePlanPost(); }; });
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

  /* ---------- save to Zillow lists via webhook ---------- */
  var SAVING_STORE = "hh.saving.v1";
  var ZILLOW_LISTS = ["Shows before Hoes", "Shared Faves", "Personal"];
  function savingMap() { try { return JSON.parse(localStorage.getItem(SAVING_STORE) || "{}"); } catch (e) { return {}; } }
  function savingAt(z) { var m = savingMap(); return m[z] && Date.now() - m[z] < 24 * 3600 * 1000 ? m[z] : 0; }
  function isSavedHome(item) {
    var all = (state.alerts && state.alerts.items) || [];
    return all.some(function (i) { return String(i.zpid) === String(item.zpid) && (i.saved || i.savedAt || i.onFaves); });
  }
  function saveBtnHTML(item) {
    var saved = isSavedHome(item), pending = !saved && savingAt(item.zpid);
    return saved ? btn(item.url || item.zillow, "Open in Zillow", IC.z, true)
      : '<button class="btn primary saveBtn" type="button" data-save="' + esc(item.zpid) + '"' + (pending ? " disabled" : "") + ">" + IC.heart + "<span>" + (pending ? "Saving…" : "Save") + "</span></button>";
  }
  function itemForSave(z) {
    var a = ((state.alerts && state.alerts.items) || []).filter(function (i) { return String(i.zpid) === String(z); })[0];
    if (a) return a;
    var s = stopByZ(String(z)); if (!s) return null;
    var p = String(s.address || "").split(",");
    return { zpid: s.zpid, address: p[0], city: (s.cityFull || s.city || (p[1] || "").trim()), url: s.zillow || s.url };
  }
  var saveTarget = null;
  function pickedLists() { return $$("#listSheet input[type=checkbox]:checked").map(function (c) { return c.value; }); }
  function syncListSave() { var b = $("#listSave"); if (b) b.disabled = !pickedLists().length; }
  function closeListSheet() {
    var el = $("#listSheet"); if (!el || el.hidden) return;
    el.hidden = true;
    $$("input[type=checkbox]", el).forEach(function (c) { c.checked = false; });
    syncListSave(); saveTarget = null;
  }
  function openListSheet(item) {
    if (!hookCfg()) { openSettings(true); return; }
    saveTarget = item;
    var g = $("#listOpts");
    if (g && !g.childElementCount) g.innerHTML = ZILLOW_LISTS.map(function (n) {
      return '<label class="row checkRow"><span>' + esc(n) + '</span><input type="checkbox" value="' + esc(n) + '"></label>';
    }).join("");
    $$("input[type=checkbox]", $("#listSheet")).forEach(function (c) { c.checked = false; });
    syncListSave();
    $("#listSheet").hidden = false;
  }
  function markSaveBtns(z, pending) {
    $$("[data-save]").forEach(function (b) {
      if (String(b.dataset.save) !== String(z)) return;
      b.disabled = !!pending;
      (b.querySelector("span") || b.lastChild).textContent = pending ? "Saving…" : "Save";
    });
  }
  function saveHome(item, lists) {
    if (!hookCfg()) { openSettings(true); return; }
    if (!lists || !lists.length) return;
    closeListSheet();
    markSaveBtns(item.zpid, true);
    postHook({ action: "save", zpid: String(item.zpid), address: item.address + ", " + item.city, url: item.url || item.zillow, lists: lists }).then(function () {
      var m = savingMap(); m[item.zpid] = Date.now(); localStorage.setItem(SAVING_STORE, JSON.stringify(m));
    }, function (e) { markSaveBtns(item.zpid, false); toast(hookErr(e)); });
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
  function carousel(item, bare) {
    var photos = (item.photos || []).map(function (p) { return typeof p === "string" ? { url: p } : p; }).filter(function (p) { return p && p.url; }).slice(0, bare ? 24 : 8);
    var badge = bare ? "" : item.kind === "drop" ? '<span class="badge drop">PRICE DROP</span>' : item.kind === "status" ? '<span class="badge status">' + esc((item.newStatus || "Status change").toUpperCase()) + "</span>" : '<span class="badge new">NEW</span>';
    var x = bare ? "" : '<button class="dismissX" type="button" aria-label="Dismiss" data-dismiss>✕</button>';
    if (!photos.length) return '<div class="car">' + badge + x + "</div>";
    return '<div class="car" data-car>' + badge + x + '<span class="count">1 / ' + photos.length + "</span>" +
      '<div class="carTrack">' + photos.map(function (p, i) { return '<div class="ph"><img alt="' + esc(p.label || "Photo " + (i + 1)) + " · " + esc(item.address) + '" data-src="' + esc(cardSize(p.url)) + '" data-full="' + esc(fullSize(p.url)) + '" data-label="' + esc(p.label || "") + '" data-pri="' + (i === 0 ? 0 : i === 1 ? 1 : 2) + '" data-i="' + i + '" draggable="false">' + (p.label ? '<span class="phLabel">' + esc(p.label) + "</span>" : "") + "</div>"; }).join("") + "</div>" +
      (photos.length > 1 ? '<button class="arrow left" type="button" aria-label="Previous photo" disabled>‹</button><button class="arrow right" type="button" aria-label="Next photo">›</button>' + (photos.length <= 10 ? '<div class="dots">' + photos.map(function (_, i) { return "<i" + (i === 0 ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" : "") : "") + "</div>";
  }
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  function histHTML(h, kind) {
    var hist = ""; h = h || [];
    if (h.length >= 2) {
      var base = h.filter(function (x) { return !x.sold; }), orig = (base[0] || h[0]).price, last = h[h.length - 1].price;
      var note = last < orig ? money(orig - last) + " (" + ((orig - last) / orig * 100).toFixed(1) + "%) below original" : "";
      hist = '<div class="hist"><div class="histH"><span>Price history</span><em>' + esc(note) + '</em></div><div class="track"><div class="line"></div>' +
        h.map(function (x, i) { var cls = i === h.length - 1 ? (kind === "status" ? " pend" : " now") : ""; return '<div class="step' + cls + '"><div class="d"></div><div class="sp">' + (x.label ? esc(x.label) : short$(x.price)) + '</div><div class="sd">' + esc(x.date) + "</div></div>"; }).join("") + "</div></div>";
    }
    return hist;
  }
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
    var hist = histHTML(item.history, item.kind);
    return '<article class="card home" data-id="' + esc(cardId(item)) + '">' + carousel(item) + '<div class="hb"><div class="date">' + esc(item.headline || "") + (item.headline ? " · " : "") + esc(fmtDate(item.date)) + "</div>" +
      '<div class="addr">' + esc(item.address) + '</div><div class="city">' + esc(item.city) + (item.area ? " · " + esc(item.area) : "") + typeTag(item) + "</div>" +
      '<div class="prow">' + prow + '</div><div class="tiles">' + tiles + '</div><div class="facts">' + facts + "</div>" + hist +
      (item.note ? '<div class="note">' + esc(item.note) + "</div>" : "") +
      '<div class="btns">' + saveBtnHTML(item) + btn(mapsSearch(item.address + ", " + item.city), "Navigate", IC.nav) + askBtn(item.zpid, item.address, String(item.city || "").split(",")[0], true) + "</div></div></article>";
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
    $$("article.home .addr, article.home .city", el).forEach(function (t) { t.classList.add("tapOpen"); t.onclick = function () {
      var card = t.closest("article.home"), it = allItems.filter(function (i) { return cardId(i) === card.dataset.id; })[0]; if (it) openDetail(it, false); }; });
    $$("[data-save]", el).forEach(function (b) { b.onclick = function () { var it = itemForSave(b.dataset.save); if (it) openListSheet(it); }; });
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

  /* ---------- home detail sheet (mini listing page), shared by Showings stops and Alerts cards ---------- */
  function alertFor(z) { return ((state.alerts && state.alerts.items) || []).filter(function (i) { return String(i.zpid) === String(z); }); }
  function shortDate(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return iso || "";
    return +m[1] === new Date().getFullYear() ? +m[2] + "/" + +m[3] : +m[2] + "/" + m[1].slice(2);
  }
  function stopByZ(k) {
    var all = planDays().concat((state.showings && state.showings.days) || []), hit = null;
    all.forEach(function (d) { (d.showings || []).forEach(function (s) { if (!hit && (String(s.zpid) === k || s.address === k)) hit = s; }); });
    return hit;
  }
  function detailData(src, isStop) {
    var al = alertFor(src.zpid), drop = al.filter(function (i) { return i.kind === "drop"; })[0], any = drop || al[0] || {};
    var L = src.listing || any.listing || {};
    var addr = isStop ? String(src.address || "").split(",")[0] : src.address, city = isStop ? (src.cityFull || src.city || "") : src.city;
    var photos = (L.photos && L.photos.length ? L.photos : any.photos && any.photos.length ? any.photos : src.photos || []).slice();
    if (!photos.length && src.photo) photos = [src.photo];
    var obs = (drop && drop.history) || src.history || [];
    var hist = obs.length >= 2 ? obs : (L.history || []).map(function (x) { return { date: (x.label ? x.label + " · " : "") + shortDate(x.date), price: x.price, sold: /sold/i.test(x.label || "") }; });
    var price = src.price || L.price, old = (drop && drop.oldPrice) || (L.priceChange ? price - L.priceChange : null);
    return { zpid: src.zpid, address: addr, city: city, area: any.area, showType: src.showType || any.showType, price: price, oldPrice: old && old !== price ? old : null,
      beds: src.beds || L.beds, baths: src.baths || L.baths, sqft: src.sqft || L.sqft, acres: src.acres || L.acres, built: src.built || L.built,
      description: L.description || "", facts: L.facts || [], history: hist, photos: photos, status: L.status,
      zillow: src.zillow || src.url || L.url || (src.zpid ? "https://www.zillow.com/homedetails/" + src.zpid + "_zpid/" : ""),
      nav: mapsSearch(addr + ", " + city) };
  }
  function detailHTML(h) {
    var prow = '<span class="price">' + (h.price ? money(h.price) : "") + "</span>";
    if (h.oldPrice) {
      var diff = h.oldPrice - h.price, pct = Math.abs(diff) / h.oldPrice * 100;
      prow += '<span class="was">' + money(h.oldPrice) + '</span><span class="pill ' + (diff > 0 ? "red" : "green") + '">' + (diff > 0 ? "▼ " : "▲ ") + money(Math.abs(diff)) + " · " + pct.toFixed(1) + "%</span>";
    }
    var st = h.status && !/^for sale$/i.test(h.status) ? ' <span class="pill amber">' + esc(h.status) + "</span>" : "";
    var tiles = [["Beds", h.beds], ["Baths", h.baths], ["Sq ft", h.sqft ? Number(h.sqft).toLocaleString() : null], ["Acres", h.acres], ["Built", h.built]]
      .map(function (t) { return '<div class="tile"><b>' + esc(t[1] == null || t[1] === "" ? "—" : t[1]) + "</b><span>" + t[0] + "</span></div>"; }).join("");
    var facts = h.facts.filter(function (f) { return f[0] !== "Per sq ft" || !h.price; }).map(function (f) { return '<div class="fact' + (String(f[1]).length > 16 ? " full" : "") + '"><span>' + esc(f[0]) + "</span><b>" + esc(f[1]) + "</b></div>"; }).join("");
    var desc = h.description ? '<div class="dDesc clamp"><p>' + esc(h.description).replace(/\n+/g, "</p><p>") + '</p></div><button class="dMore" type="button">More</button>' : "";
    var save = h.zpid && (h.zillow || h.url) && !isSavedHome(h) ? saveBtnHTML(h) : "";
    return carousel({ photos: h.photos, address: h.address }, true) + '<div class="hb dBody"><div class="addr">' + esc(h.address) + "</div>" +
      '<div class="city">' + esc(h.city) + (h.area ? " · " + esc(h.area) : "") + typeTag(h) + "</div>" +
      '<div class="prow">' + prow + st + '</div><div class="tiles t5">' + tiles + "</div>" + desc +
      (facts ? '<div class="facts">' + facts + "</div>" : "") + histHTML(h.history, null) +
      '<div class="btns">' + save + btn(h.nav, "Navigate", IC.nav, !save) + (h.zillow ? '<a class="btn ico" href="' + esc(h.zillow) + '" target="_blank" rel="noopener noreferrer" aria-label="Zillow">' + IC.z + "</a>" : "") + askBtn(h.zpid, h.address, String(h.city || "").split(",")[0], true) + "</div></div>";
  }
  var D = null;
  function openDetail(src, isStop) {
    if (!D) {
      D = document.createElement("div"); D.className = "dWrap"; D.hidden = true;
      D.innerHTML = '<div class="dBg"></div><div class="dSheet" role="dialog" aria-modal="true" aria-label="Home details"><div class="dGrab"><i></i></div><button class="dClose" type="button" aria-label="Close">✕</button><div class="dScroll"></div></div>';
      document.body.appendChild(D);
      $(".dBg", D).onclick = closeDetail; $(".dClose", D).onclick = closeDetail;
      bindDetailDrag();
    }
    var sc = $(".dScroll", D);
    sc.innerHTML = detailHTML(detailData(src, isStop)); sc.scrollTop = 0;
    $$("[data-car]", sc).forEach(bindCarousel);
    var mb = $(".dMore", sc), dd = $(".dDesc", sc);
    if (mb) requestAnimationFrame(function () { if (dd.scrollHeight <= dd.clientHeight + 4) { mb.remove(); dd.classList.remove("clamp"); } });
    if (mb) mb.onclick = function () { dd.classList.remove("clamp"); mb.remove(); };
    $$("[data-save]", sc).forEach(function (b) { b.onclick = function () { var it = itemForSave(b.dataset.save); if (it) openListSheet(it); }; });
    clearTimeout(D._t); D.hidden = false; document.body.classList.add("noScroll"); sc.scrollTop = 0;
    var sh = $(".dSheet", D); sh.style.transform = ""; sh.classList.remove("closing");
  }
  function closeDetail() {
    if (!D || D.hidden) return;
    var sh = $(".dSheet", D); sh.classList.add("closing"); sh.style.transform = "translateY(100%)";
    clearTimeout(D._t); D._t = setTimeout(function () { D.hidden = true; sh.classList.remove("closing"); sh.style.transform = ""; $(".dScroll", D).innerHTML = ""; document.body.classList.remove("noScroll"); }, 220);
  }
  /* swipe down to dismiss: from the grab bar anywhere, or from the content when it's scrolled to the top (vertical drags only) */
  function bindDetailDrag() {
    var sh = $(".dSheet", D), sc = $(".dScroll", D), y0 = null, x0 = 0, dy = 0, lock = null;
    sh.addEventListener("touchstart", function (e) {
      var onGrab = !!e.target.closest(".dGrab");
      if (!onGrab && sc.scrollTop > 0) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; lock = onGrab ? "y" : null; sh.style.transition = "none";
    }, { passive: true });
    sh.addEventListener("touchmove", function (e) {
      if (y0 == null) return; var my = e.touches[0].clientY - y0, mx = e.touches[0].clientX - x0;
      if (lock == null && (Math.abs(my) > 8 || Math.abs(mx) > 8)) lock = my > 0 && Math.abs(my) > Math.abs(mx) * 1.3 ? "y" : "n";
      if (lock !== "y") return;
      dy = Math.max(0, my); if (e.cancelable) e.preventDefault(); sh.style.transform = "translateY(" + dy + "px)";
    }, { passive: false });
    sh.addEventListener("touchend", function () {
      sh.style.transition = ""; if (y0 == null) return; y0 = null;
      if (lock === "y" && dy > 110) closeDetail(); else sh.style.transform = "";
    }, { passive: true });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("#listSheet") && !$("#listSheet").hidden) { closeListSheet(); return; }
    if (D && !D.hidden && V.el.hidden) closeDetail();
  });

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
  (function () {
    var el = $("#listSheet"), g = $("#listOpts");
    if (g) g.innerHTML = ZILLOW_LISTS.map(function (n) {
      return '<label class="row checkRow"><span>' + esc(n) + '</span><input type="checkbox" value="' + esc(n) + '"></label>';
    }).join("");
    if (el) {
      el.addEventListener("change", syncListSave);
      $$("[data-list-close]", el).forEach(function (b) { b.onclick = closeListSheet; });
    }
    if ($("#listSave")) $("#listSave").onclick = function () {
      var lists = pickedLists(); if (!lists.length || !saveTarget) return; saveHome(saveTarget, lists);
    };
  })();
  $("#lockBtn").onclick = function () { localStorage.removeItem(KEY_STORE); state.showings = null; sheet.hidden = true; renderShowings(); setTab("showings"); toast("Locked on this device"); };
  $("#reloadBtn").onclick = function () { sheet.hidden = true; loadAll(true); };
  $("#hookSave").onclick = function () {
    var u = $("#hookUrl").value.trim(), k = $("#hookKey").value.trim().replace(/^authorization:\s*/i, "").replace(/^bearer\s+/i, "").trim();
    if (!/^https:\/\//.test(u) || !k) { $("#hookStatus").textContent = "Need https URL and key"; return; }
    localStorage.setItem(HOOK_STORE, JSON.stringify({ url: u, key: k })); $("#hookKey").value = k; $("#hookStatus").textContent = "Saved"; renderAlerts();
  };
  $("#hookClear").onclick = function () { localStorage.removeItem(HOOK_STORE); $("#hookUrl").value = ""; $("#hookKey").value = ""; $("#hookStatus").textContent = "Cleared"; };
  window.addEventListener("scroll", function () { $("#top").classList.toggle("scrolled", window.scrollY > 4); }, { passive: true });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") loadAll(false).then(pollSoon, pollSoon); });
  window.addEventListener("focus", function () { if (pendingKeys().length || anyServerSync()) loadAll(false).then(pollSoon, pollSoon); });

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
  loadAll(false).then(pollSoon, pollSoon);
})();
