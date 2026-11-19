/* House Hunter: Showings (encrypted) + Alerts & New Homes. Plain JS, no build step. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return "$" + Math.round(n).toLocaleString("en-US"); };
  var short$ = function (v) { return "$" + (v >= 1e6 ? (v / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "M" : Math.round(v / 1000) + "K"); };
  var KEY_STORE = "hh.showingsKey.v1", TAB_STORE = "hh.tab", VIEW_STORE = "hh.view", FILTER_STORE = "hh.filter", SEEN_STORE = "hh.alertsSeen";
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
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 1800); }
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
      return decryptWith(raw, enc).then(function (data) { state.showings = data; state.unlockError = ""; })
        .catch(function () { localStorage.removeItem(KEY_STORE); state.showings = null; state.unlockError = "The passcode changed. Enter the new one."; });
    }).catch(function () { state.enc = null; });
  }
  function loadAlerts() { return fetchJSON("data/alerts.json").then(function (a) { state.alerts = a; }).catch(function () { if (!state.alerts) state.alerts = { items: [] }; }); }
  function loadAll(manual) {
    var b = $("#refreshBtn"); b.classList.add("spin");
    return Promise.all([loadShowings(), loadAlerts()]).then(function () {
      b.classList.remove("spin"); render(); if (manual) toast("Up to date");
    });
  }

  /* ---------- showings tab ---------- */
  function currentDay() {
    var d = state.showings; if (!d || !d.days || !d.days.length) return null;
    var id = state.dayId || d.currentDay;
    return d.days.filter(function (x) { return x.id === id; })[0] || d.days[0];
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
  function stopCard(s) {
    var isDoor = /door/i.test(s.code || "");
    var code = String(s.code || "").replace(/\s*\(door code\)/i, "");
    var rating = s.rating ? '<span class="stars">' + "★".repeat(s.rating) + "☆".repeat(5 - s.rating) + "</span>" : "";
    var take = (s.rating || s.notes) ? '<div class="take"><div class="takeTop"><b>Your take</b>' + rating + "</div>" + (s.notes ? "<p>" + esc(s.notes) + "</p>" : "") + "</div>" : "";
    var tel = s.phone ? "tel:" + String(s.phone).replace(/[^0-9+]/g, "") : "";
    return '<article class="card stop">' +
      '<div class="stopHead"><div class="num' + (s.confirmed === false ? " pending" : "") + '">' + esc(s.n) + '</div><div style="flex:1;min-width:0"><div class="stopTime">' + esc(s.time) + (s.navFrom ? " · " + esc(s.navFrom) : "") + '</div><div class="stopAddr">' + esc(s.address) + "</div></div>" +
      (s.confirmed === false ? '<span class="pill amber">Requested</span>' : '<span class="pill green">Confirmed</span>') + "</div>" +
      '<div class="codeBox"><div><div class="lbl">' + (isDoor ? "Door code" : "Lockbox code") + '</div><div class="code">' + esc(code) + '</div></div><div class="priceR"><b>' + short$(s.price) + "</b>" +
      (s.was ? '<small class="cut">Cut from ' + short$(s.was) + "</small>" : "<small>" + esc(s.dom) + " days on Zillow</small>") + "</div></div>" +
      '<div class="basics">' + esc(s.beds) + " bd · " + esc(s.baths) + " ba · " + Number(s.sqft).toLocaleString() + " sq ft · " + esc(s.acres) + " ac · " + esc(s.style) + "</div>" +
      (s.flag ? '<div class="flag">⚠️ ' + esc(s.flag) + "</div>" : "") +
      '<div class="door"><b>At the door:</b> ' + esc(s.instructions) + "</div>" +
      '<div class="agentLine">Listing agent: ' + esc(s.agentName) + " · " + esc(s.phone) + (s.coAgent ? " · Co-agent " + esc(s.coAgent) : "") + "</div>" + take +
      '<div class="btns">' + btn(s.nav, "Navigate", IC.nav, true) + btn(tel, "Call agent", IC.call) + btn(s.zillow, "Zillow", IC.z) + btn(s.confirmUrl, s.confirmLabel || "Confirmation", IC.doc) + "</div></article>";
  }
  function mapSVG(m) {
    if (!m) return "";
    var halo = 'paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"', font = 'font-family="Roboto, Arial, sans-serif"';
    var o = '<svg viewBox="0 0 560 410" role="img" aria-label="Route map"><rect width="560" height="410" fill="#f5f2ea"/>' +
      '<path d="' + m.reservoir + '" fill="#aad3f5"/>' +
      '<path d="' + m.primary + '" fill="none" stroke="#d6d1c4" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="' + m.primary + '" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + m.trunk + '" fill="none" stroke="#e8c35a" stroke-width="3.5" stroke-linejoin="round"/><path d="' + m.trunk + '" fill="none" stroke="#fde293" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="' + m.motorway + '" fill="none" stroke="#e0a33a" stroke-width="4.5" stroke-linejoin="round"/><path d="' + m.motorway + '" fill="none" stroke="#fbc35d" stroke-width="3" stroke-linejoin="round"/>';
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
    return '<div class="secHead"><h2>Route</h2></div><p class="caption">' + esc(day.routeCaption || "") + "</p>" +
      '<div class="card mapBox">' + mapSVG(day.map) + '<div class="legend"><span><i style="background:' + GREEN + '"></i>Confirmed</span><span><i style="background:' + YELLOW + '"></i>Not confirmed</span><span><i style="background:#d93025"></i>Home</span></div></div>' +
      '<div class="secHead"><h2>Directions</h2><span>Opens Google Maps</span></div><div class="card links">' + rows + "</div>";
  }
  function table(cols, rows, cls) {
    return '<div class="card tblWrap"><table><thead><tr>' + cols.map(function (c, i) { return "<th" + (cls && cls[i] === "r" ? ' class="r"' : "") + ">" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return '<td class="' + ((cls && cls[i]) || "") + '">' + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  var a = function (href, label) { return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : ""; };
  function compareHTML(day) {
    var rows = day.showings.map(function (s) {
      return [esc(s.n + ". " + s.short), short$(s.price), "$" + Math.round(s.price / s.sqft), Number(s.sqft).toLocaleString(), esc(s.acres), esc(s.built), esc(s.beds + "/" + s.baths), esc(s.hoa), esc(s.style),
        s.rating ? '<span class="stars">' + "★".repeat(s.rating) + "</span>" + (s.notes ? "<br>" + esc(s.notes) : "") : esc(s.notes || "Not toured")];
    });
    return '<div class="secHead"><h2>Side by side</h2></div><p class="caption">' + esc(day.compareCaption || "") + "</p>" +
      table(["Home", "Price", "$/sq ft", "Sq ft", "Acres", "Built", "Bd/Ba", "HOA", "Style", "Your take"], rows, ["", "r", "r", "r", "r", "r", "r", "mid", "mid", "wide"]);
  }
  function detailsHTML(day) {
    var rows = day.showings.map(function (s) {
      return [esc(s.address), esc(s.date), esc(s.time), esc(s.code), esc(s.mls), esc(s.access), esc(s.instructions), esc(s.agent), a(s.confirmUrl, s.confirmLabel), a(s.zillow, "Listing")];
    });
    return '<div class="secHead"><h2>All confirmation details</h2></div>' +
      table(["Home", "Date", "Time", "Lockbox code", "MLS", "Access", "Instructions", "Listing agent", "Confirmation", "Zillow"], rows, ["", "nw", "nw", "ok nw", "nw", "wide", "wide", "mid", "nw", "nw"]);
  }
  function renderShowings() {
    var el = $("#tab-showings");
    var day = currentDay();
    if (!day) { el.innerHTML = unlockHTML(); bindUnlock(); return; }
    var days = state.showings.days;
    var chips = days.length > 1 ? '<div class="dayChips">' + days.map(function (d) { return '<button class="chip' + (d.id === day.id ? " on" : "") + '" data-day="' + esc(d.id) + '">' + esc(d.label || d.date) + "</button>"; }).join("") + "</div>" : "";
    var metrics = (day.metrics || []).map(function (m) { return '<div class="metric"><b>' + esc(m.value) + "</b><span>" + esc(m.label) + "</span>" + (m.detail ? "<em>" + esc(m.detail) + "</em>" : "") + "</div>"; }).join("");
    var views = [["stops", "Stops"], ["map", "Route"], ["compare", "Compare"], ["details", "All details"]];
    var body = "";
    if (state.view === "map") body = routeHTML(day);
    else if (state.view === "compare") body = compareHTML(day);
    else if (state.view === "details") body = detailsHTML(day);
    else body = '<div class="secHead"><h2>Stops</h2><span>' + day.showings.length + ' homes</span></div><p class="caption">' + esc(day.stopsCaption || "") + '</p><div class="stack">' + day.showings.map(stopCard).join("") + "</div>";
    el.innerHTML = chips + '<div class="card dayCard"><div class="dayTop"><div><div class="dayTitle">' + esc(day.title) + '</div><div class="daySum">Start and end at home · 30 min per home</div></div></div><div class="metrics">' + metrics + "</div></div>" +
      '<div class="seg" role="tablist" style="margin-top:14px">' + views.map(function (v) { return '<button data-view="' + v[0] + '" class="' + (state.view === v[0] ? "on" : "") + '">' + v[1] + "</button>"; }).join("") + "</div>" + body;
    $$("[data-view]", el).forEach(function (b) { b.onclick = function () { state.view = b.dataset.view; localStorage.setItem(VIEW_STORE, state.view); renderShowings(); window.scrollTo({ top: 0 }); }; });
    $$("[data-day]", el).forEach(function (b) { b.onclick = function () { state.dayId = b.dataset.day; renderShowings(); }; });
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

  /* ---------- alerts tab ---------- */
  function carousel(item) {
    var photos = item.photos || [];
    var badge = item.kind === "drop" ? '<span class="badge drop">PRICE DROP</span>' : item.kind === "status" ? '<span class="badge status">' + esc((item.newStatus || "Status change").toUpperCase()) + "</span>" : '<span class="badge new">NEW</span>';
    if (!photos.length) return '<div class="car">' + badge + "</div>";
    return '<div class="car" data-car>' + badge + '<span class="count">1 / ' + photos.length + "</span>" +
      '<div class="carTrack">' + photos.map(function (p, i) { return '<img src="' + esc(p) + '" alt="Photo ' + (i + 1) + " of " + esc(item.address) + '" loading="' + (i < 2 ? "eager" : "lazy") + '" decoding="async" referrerpolicy="no-referrer" data-i="' + i + '" draggable="false">'; }).join("") + "</div>" +
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
    var saveLabel = item.kind === "new" ? "Save on Zillow" : "Open in Zillow";
    return '<article class="card home">' + carousel(item) + '<div class="hb"><div class="date">' + esc(item.headline || "") + (item.headline ? " · " : "") + esc(fmtDate(item.date)) + "</div>" +
      '<div class="addr">' + esc(item.address) + '</div><div class="city">' + esc(item.city) + (item.area ? " · " + esc(item.area) : "") + "</div>" +
      '<div class="prow">' + prow + '</div><div class="tiles">' + tiles + '</div><div class="facts">' + facts + "</div>" + hist +
      (item.note ? '<div class="note">' + esc(item.note) + "</div>" : "") +
      '<div class="btns">' + btn(item.url, saveLabel, item.kind === "new" ? IC.heart : IC.z, true) + btn(mapsSearch(item.address + ", " + item.city), "Navigate", IC.nav) + "</div></div></article>";
  }
  function renderAlerts() {
    var el = $("#tab-alerts"), items = ((state.alerts && state.alerts.items) || []).slice();
    items.sort(function (x, y) { return (y.date || "").localeCompare(x.date || ""); });
    var al = items.filter(function (i) { return i.kind !== "new"; }), nw = items.filter(function (i) { return i.kind === "new"; });
    var f = state.filter;
    var chip = function (k, label, n) { return '<button class="chip' + (f === k ? " on" : "") + '" data-f="' + k + '">' + label + "<b>" + n + "</b></button>"; };
    var html = '<div class="chips">' + chip("all", "All", items.length) + chip("alerts", "Alerts", al.length) + chip("new", "New", nw.length) + "</div>";
    if (f !== "new") html += '<div class="secHead"><h2>Alerts</h2><span>Price drops &amp; status changes</span></div>' + (al.length ? '<div class="stack alertsGrid">' + al.map(homeCard).join("") + "</div>" : '<div class="card empty">No price drops or status changes yet.</div>');
    if (f !== "alerts") html += '<div class="secHead"><h2>New listings</h2><span>From your listing watch</span></div>' + (nw.length ? '<div class="stack alertsGrid">' + nw.map(homeCard).join("") + "</div>" : '<div class="card empty">No new matches yet.</div>');
    if (state.alerts && state.alerts.updated) html += '<p class="updated">Updated ' + esc(new Date(state.alerts.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + "</p>";
    el.innerHTML = html;
    $$("[data-f]", el).forEach(function (b) { b.onclick = function () { state.filter = b.dataset.f; localStorage.setItem(FILTER_STORE, state.filter); renderAlerts(); }; });
    $$("[data-car]", el).forEach(function (c, ci) { bindCarousel(c); });
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
    var srcs = $$("img", track).map(function (i) { return i.getAttribute("src"); });
    $$("img", track).forEach(function (img) {
      img.addEventListener("click", function () { openViewer(srcs, +img.dataset.i); });
      img.addEventListener("error", function () { img.style.opacity = 0; });
    });
  }

  /* ---------- full-screen viewer ---------- */
  var V = { el: $("#viewer"), track: $("#vTrack"), n: 0 };
  function vIdx() { return Math.round(V.track.scrollLeft / Math.max(1, V.track.clientWidth)); }
  function vUpd() { var i = vIdx(); $("#vCount").textContent = (i + 1) + " / " + V.n; $("#vPrev").disabled = i <= 0; $("#vNext").disabled = i >= V.n - 1; }
  function openViewer(srcs, start) {
    V.n = srcs.length;
    V.track.innerHTML = srcs.map(function (s, i) { return '<div><img src="' + esc(s) + '" alt="Photo ' + (i + 1) + '" referrerpolicy="no-referrer" draggable="false"></div>'; }).join("");
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
    if (t === "alerts") renderAlerts();
    window.scrollTo({ top: 0 });
  }
  function render() { renderShowings(); renderAlerts(); setTab(state.tab); }
  $$(".tabBtn").forEach(function (b) { b.onclick = function () { if (state.tab === b.dataset.tab) window.scrollTo({ top: 0, behavior: "smooth" }); else setTab(b.dataset.tab); }; });
  $("#refreshBtn").onclick = function () { loadAll(true); };
  var sheet = $("#sheet");
  $("#settingsBtn").onclick = function () {
    $("#lockBtn").disabled = !localStorage.getItem(KEY_STORE);
    var u = state.enc && state.enc.updated ? "Showings updated " + new Date(state.enc.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ". " : "";
    $("#aboutLine").textContent = u + "Add to Home Screen from Safari's Share menu to use House Hunter full screen.";
    sheet.hidden = false;
  };
  $$("[data-close]", sheet).forEach(function (b) { b.onclick = function () { sheet.hidden = true; }; });
  $("#lockBtn").onclick = function () { localStorage.removeItem(KEY_STORE); state.showings = null; sheet.hidden = true; renderShowings(); setTab("showings"); toast("Locked on this device"); };
  $("#reloadBtn").onclick = function () { sheet.hidden = true; loadAll(true); };
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
