/* lloreve — browser UI. State in localStorage; all logic in lloreve.js. */
"use strict";
(function () {
  const L = window.lloreve;
  const STORE_KEY = "lloreve.v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- state ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(L.PRESETS);
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return structuredClone(L.PRESETS);
      return data.filter((t) => L.validateTitle(t).length === 0);
    } catch {
      return structuredClone(L.PRESETS);
    }
  }
  let titles = load();
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(titles));
  }
  const saveAndRender = () => { save(); render(); };

  /* ---------- stats ---------- */
  function renderStats() {
    const s = L.collectionStats(titles);
    const pctBar = (pct) =>
      pct === null ? "" : `<div class="bar"><i style="width:${pct}%"></i></div>`;
    const cell = (num, unit, label, pct, sub) => `
      <div class="stat">
        <div class="num">${num} <span class="unit">${unit}</span></div>
        <div class="lbl">${label}</div>
        ${pctBar(pct)}
        ${sub ? `<div class="sub">${sub}</div>` : ""}
      </div>`;
    $("stats").innerHTML =
      cell(s.titles, "titles", "in collection", null,
        `${s.byStatus.reading} reading · ${s.byStatus.completed} completed`) +
      cell(s.owned.ln, "vol", "light novel owned", s.completionPct.ln,
        s.completionPct.ln === null ? "no known totals" : `${s.completionPct.ln}% of known totals`) +
      cell(s.owned.manga, "ch", "manga chapters owned", s.completionPct.manga,
        s.completionPct.manga === null ? "no known totals" : `${s.completionPct.manga}% of known totals`) +
      cell(s.owned.anime, "ep", "anime episodes owned", s.completionPct.anime,
        s.avgRating === null ? "no ratings yet" : `★ ${s.avgRating} average rating`);
  }

  /* ---------- list ---------- */
  function visibleTitles() {
    const q = $("search").value.trim().toLowerCase();
    const status = $("filter-status").value;
    const sort = $("sort").value;
    let out = titles.filter((t) => {
      if (status && t.status !== status) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    const byCompletion = (a, b) => (L.titleCompletion(b) ?? -1) - (L.titleCompletion(a) ?? -1) || byName(a, b);
    const byRating = (a, b) => b.rating - a.rating || byName(a, b);
    if (sort === "name") out.sort(byName);
    else if (sort === "completion") out.sort(byCompletion);
    else if (sort === "rating") out.sort(byRating);
    else if (sort === "recent") out.reverse(); // insertion order, newest last
    return out;
  }

  function trackView(t, track) {
    const p = L.titleProgress(t).per[track];
    const unit = t.units[track];
    const ownedStr = L.rangeToString(t.owned[track]);
    const nums = p.total > 0
      ? `${p.owned} / ${p.total} ${unit} · ${p.pct}%`
      : `${p.owned} ${unit}${ownedStr ? ` · ${esc(ownedStr)}` : " · none yet"}`;
    return `<div class="track">
      <div class="t-label">${esc(L.TRACK_LABEL[track])}</div>
      <div class="t-nums">${nums}</div>
      ${p.pct === null ? "" : `<div class="bar"><i style="width:${p.pct}%"></i></div>`}
    </div>`;
  }

  function equivView(t) {
    const lines = [];
    for (const from of L.TRACKS) {
      if (L.rangeTotal(t.owned[from] || []) === 0) continue;
      const parts = [];
      for (const to of L.TRACKS) {
        if (to === from) continue;
        const cov = L.equivalentCoverage(t, from, to);
        if (cov.length === 0) continue;
        parts.push(`${L.TRACK_LABEL[to].toLowerCase()} <code>${esc(L.rangeToString(cov))} ${t.units[to]}</code>`);
      }
      if (parts.length > 0) {
        lines.push(`Own ${L.TRACK_LABEL[from].toLowerCase()} <b>${esc(L.rangeToString(t.owned[from]))} ${t.units[from]}</b> → covers ${parts.join(" · ")}`);
      }
    }
    return lines.length ? `<div class="equiv">${lines.join("<br>")}</div>` : "";
  }

  function mapTable(t) {
    if (!t.mappings || t.mappings.length === 0) return "";
    const cell = (r) => (r === null || r === undefined ? `<td class="na">—</td>` : `<td>${r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`}</td>`);
    const rows = t.mappings.map((m) => `<tr>${cell(m.ln)}${cell(m.manga)}${cell(m.anime)}</tr>`).join("");
    return `<table class="map-table">
      <thead><tr><th>LN (${esc(t.units.ln)})</th><th>Manga (ch)</th><th>Anime (ep)</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderList() {
    const vis = visibleTitles();
    $("empty").hidden = vis.length !== 0;
    $("list").innerHTML = vis.map((t) => {
      const comp = L.titleCompletion(t);
      const stars = t.rating > 0 ? `<span class="stars" title="Rated ${t.rating}/5">${"★".repeat(t.rating)}${"☆".repeat(5 - t.rating)}</span>` : "";
      return `<article class="card" data-id="${esc(t.id)}">
        <div class="card-head">
          <h3>${esc(t.name)}</h3>
          <span>
            ${stars}
            <span class="badge ${esc(t.status)}">${esc(t.status)}${comp !== null ? ` · ${comp}%` : ""}</span>
          </span>
        </div>
        <div class="tracks-view">
          ${L.TRACKS.map((tr) => trackView(t, tr)).join("")}
        </div>
        ${equivView(t)}
        ${mapTable(t)}
        <div class="card-actions" style="margin-top:12px">
          <button class="btn small" data-act="edit" type="button">Edit</button>
          <button class="btn small danger" data-act="delete" type="button">Delete</button>
        </div>
      </article>`;
    }).join("");
  }

  function render() {
    renderStats();
    renderList();
  }

  /* ---------- editor dialog ---------- */
  function mappingRowEl(row) {
    const div = document.createElement("div");
    div.className = "map-row";
    const val = (r) => (r ? (r[0] === r[1] ? String(r[0]) : `${r[0]}-${r[1]}`) : "");
    div.innerHTML = `
      <label>LN range<input type="text" data-k="ln" value="${esc(val(row.ln))}" placeholder="1-2" autocomplete="off"></label>
      <label>Manga range<input type="text" data-k="manga" value="${esc(val(row.manga))}" placeholder="1-12" autocomplete="off"></label>
      <label>Anime range<input type="text" data-k="anime" value="${esc(val(row.anime))}" placeholder="1-4" autocomplete="off"></label>
      <button class="btn small danger" type="button" data-remove-row>✕</button>`;
    div.querySelector("[data-remove-row]").addEventListener("click", () => div.remove());
    return div;
  }

  function readMappings() {
    const rows = [];
    for (const div of $("mapping-rows").querySelectorAll(".map-row")) {
      const row = { ln: null, manga: null, anime: null };
      for (const input of div.querySelectorAll("input[data-k]")) {
        const v = input.value.trim();
        if (v === "") continue;
        const parsed = L.parseRanges(v);
        if (parsed.length !== 1) throw new RangeError(`mapping cell "${v}" must be a single range`);
        row[input.dataset.k] = parsed[0];
      }
      rows.push(row);
    }
    return rows;
  }

  function openDialog(t) {
    const isNew = !t;
    const d = isNew ? L.blankTitle() : structuredClone(t);
    $("dialog-title").textContent = isNew ? "Add title" : `Edit — ${d.name}`;
    $("f-id").value = d.id;
    $("f-name").value = d.name;
    $("f-status").value = d.status;
    $("f-rating").value = d.rating;
    $("f-unit-ln").value = d.units.ln;
    for (const track of L.TRACKS) {
      $(`f-owned-${track}`).value = L.rangeToString(d.owned[track]);
      $(`f-total-${track}`).value = d.total[track];
    }
    $("mapping-rows").innerHTML = "";
    (d.mappings.length ? d.mappings : [{}]).forEach((row) =>
      $("mapping-rows").appendChild(mappingRowEl(row)));
    $("form-error").hidden = true;
    $("dialog-backdrop").hidden = false;
    $("f-name").focus();
  }
  const closeDialog = () => { $("dialog-backdrop").hidden = true; };

  $("btn-add").addEventListener("click", () => openDialog(null));
  $("btn-cancel").addEventListener("click", closeDialog);
  $("dialog-backdrop").addEventListener("click", (e) => {
    if (e.target === $("dialog-backdrop")) closeDialog();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("dialog-backdrop").hidden) closeDialog();
  });
  $("btn-add-row").addEventListener("click", () =>
    $("mapping-rows").appendChild(mappingRowEl({})));

  $("dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    const err = $("form-error");
    try {
      const t = L.blankTitle();
      t.id = $("f-id").value || t.id;
      t.name = $("f-name").value.trim();
      t.status = $("f-status").value;
      t.rating = Math.max(0, Math.min(5, Number($("f-rating").value) || 0));
      t.units = { ln: $("f-unit-ln").value, manga: "ch", anime: "ep" };
      for (const track of L.TRACKS) {
        t.owned[track] = L.parseRanges($(`f-owned-${track}`).value);
        t.total[track] = Math.max(0, Math.floor(Number($(`f-total-${track}`).value) || 0));
      }
      t.mappings = readMappings().filter((r) =>
        L.TRACKS.some((k) => r[k] !== null));
      const errors = L.validateTitle(t);
      if (errors.length > 0) throw new Error(errors.join("\n"));
      const i = titles.findIndex((x) => x.id === t.id);
      if (i >= 0) titles[i] = t;
      else titles.push(t);
      saveAndRender();
      closeDialog();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $("list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const card = e.target.closest(".card");
    const t = titles.find((x) => x.id === card.dataset.id);
    if (!t) return;
    if (btn.dataset.act === "edit") openDialog(t);
    if (btn.dataset.act === "delete" &&
        confirm(`Delete "${t.name}" from your collection?`)) {
      titles = titles.filter((x) => x.id !== t.id);
      saveAndRender();
    }
  });

  /* ---------- toolbar ---------- */
  ["search", "filter-status", "sort"].forEach((id) =>
    $(id).addEventListener("input", renderList));
  $("btn-reset").addEventListener("click", () => {
    if (confirm("Replace your collection with the three starter presets?")) {
      titles = structuredClone(L.PRESETS);
      saveAndRender();
    }
  });

  /* ---------- import / export ---------- */
  $("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(titles, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lloreve-collection.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error("file must contain a JSON array of titles");
      const bad = data.map((t) => L.validateTitle(t)).flat();
      if (bad.length > 0) throw new Error("invalid titles in file:\n" + bad.slice(0, 5).join("\n"));
      titles = data;
      saveAndRender();
    } catch (ex) {
      alert("Import failed: " + ex.message);
    }
    e.target.value = "";
  });

  /* ---------- collection card (PNG) ---------- */
  function drawCard() {
    const cv = $("card-canvas");
    const ctx = cv.getContext("2d");
    const W = 1200, H = 630;
    const s = L.collectionStats(titles);
    const top = L.topTitles(titles, 5);
    ctx.fillStyle = "#0a0c09";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#262b22";
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    // header
    ctx.fillStyle = "#a3e635";
    ctx.font = "700 54px system-ui, sans-serif";
    ctx.fillText("lloreve", 64, 108);
    ctx.fillStyle = "#9aa393";
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillText("my cross-media collection", 64, 146);
    ctx.fillStyle = "#e8eae2";
    ctx.font = "22px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), W - 64, 108);
    ctx.textAlign = "left";
    // stat row
    const stats = [
      [String(s.titles), "titles"],
      [`${s.owned.ln}`, "LN vol owned"],
      [`${s.owned.manga}`, "manga ch owned"],
      [`${s.owned.anime}`, "anime ep owned"],
    ];
    const colW = (W - 128) / 4;
    stats.forEach(([num, lbl], i) => {
      const x = 64 + i * colW;
      ctx.fillStyle = "#a3e635";
      ctx.font = "700 44px ui-monospace, monospace";
      ctx.fillText(num, x, 232);
      ctx.fillStyle = "#9aa393";
      ctx.font = "20px system-ui, sans-serif";
      ctx.fillText(lbl, x, 264);
    });
    // top titles
    ctx.fillStyle = "#e8eae2";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.fillText("TOP TITLES BY COMPLETION", 64, 322);
    top.forEach((entry, i) => {
      const y = 356 + i * 44;
      const comp = entry.completion === null ? 0 : entry.completion;
      ctx.fillStyle = "#e8eae2";
      ctx.font = "21px system-ui, sans-serif";
      ctx.fillText(`${i + 1}. ${entry.title.name}`, 64, y);
      ctx.fillStyle = "#9aa393";
      ctx.font = "20px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(entry.completion === null ? "—" : `${comp}%`, W - 64, y);
      ctx.textAlign = "left";
      ctx.fillStyle = "#151a12";
      ctx.fillRect(64, y + 10, W - 128, 6);
      ctx.fillStyle = "#a3e635";
      ctx.fillRect(64, y + 10, (W - 128) * (comp / 100), 6);
    });
    ctx.fillStyle = "#9aa393";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("lloreve · 100% client-side · github.com/Llunatics/lloreve", 64, H - 56);
    return cv;
  }

  $("btn-card").addEventListener("click", () => {
    const cv = drawCard();
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "lloreve-card.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  });

  render();
})();
