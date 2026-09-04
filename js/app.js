/* =========================================================
   Fagron · Dashboard Ejecutivo de Ventas — app.js
   Lee data.json (generado por data_pipeline/build_data.py)
   y controla filtros, tablas y graficos. No requiere backend.
   ========================================================= */
(function () {
  "use strict";

  const COLORS = {
    rojo: "#E43733", rojoOsc: "#C22521", grisOsc: "#4B4B4B", gris: "#9C9E9F",
    grisClaro: "#C6C7C8", grisBg: "#ECEDED", salmon: "#F5AA9A", negro: "#000000",
    verde: "#1E8A5F"
  };
  const LINEA_PALETTE = ["#E43733", "#4B4B4B", "#F5AA9A", "#9C9E9F", "#1E8A5F", "#C6C7C8", "#C22521", "#8a8c8d"];

  const fmtCOP = (n) => "$" + Math.round(n || 0).toLocaleString("es-CO");
  const fmtCOPShort = (n) => {
    n = n || 0;
    const abs = Math.abs(n);
    if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1).replace(/\.0$/, "") + "MM";
    if (abs >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + Math.round(n);
  };
  const fmtPct = (n) => (n * 100).toFixed(1).replace(".", ",") + "%";
  const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");

  let DATA = null;
  let charts = {};

  // ---- estado de filtros (indices, -1 = todos) ----
  const state = { zona: -1, linea: -1, asesor: -1, minDateIdx: 0, maxDateIdx: 0, agrupacion: "week" };

  // paginacion de tablas largas
  let cliShown = 20, famShown = 20;

  const dataPromise = window.__DASHBOARD_DATA__
    ? Promise.resolve(window.__DASHBOARD_DATA__)
    : fetch("data.json").then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar data.json (" + r.status + ")");
        return r.json();
      });

  dataPromise
    .then((json) => {
      DATA = json;
      init();
    })
    .catch((err) => {
      document.getElementById("loading").innerHTML =
        '<p style="max-width:360px;text-align:center;font-size:13px;color:#E43733;">No se pudo cargar <b>data.json</b>. Verifica que el archivo esté en la misma carpeta que index.html.<br><br>' +
        String(err.message || err) + "</p>";
    });

  function init() {
    precomputeDateKeys();
    state.minDateIdx = 0;
    state.maxDateIdx = DATA.dims.fechas.length - 1;

    fillMeta();
    fillFilters();
    fillKpis();
    bindEvents();
    recomputeAndRender();
    renderRealGeneral(DATA.real_general);
    setupScrollSpy();

    document.getElementById("loading").style.display = "none";
  }

  function fillMeta() {
    document.getElementById("meta-generado").textContent = DATA.generado || "—";
    const fc = DATA.dims.fechas[DATA.dims.fechas.length - 1];
    const mesNombre = (DATA.kpis.mes_nombre || "").toString();
    const anio = DATA.kpis.anio || "";
    document.getElementById("meta-corte").textContent =
      (mesNombre ? cap(mesNombre) + " " + anio : fc) + (fc ? " (últ. venta: " + fc + ")" : "");
  }
  function cap(s) { return s.length ? s[0] + s.slice(1).toLowerCase() : s; }

  // Pre-calcula, para cada indice de fecha, su llave de semana (lunes) y de mes
  let weekKeyOf = [], monthKeyOf = [], dateObjOf = [];
  function precomputeDateKeys() {
    DATA.dims.fechas.forEach((s) => {
      const d = new Date(s + "T00:00:00");
      dateObjOf.push(d);
      const day = (d.getDay() + 6) % 7; // lunes=0
      const monday = new Date(d);
      monday.setDate(d.getDate() - day);
      weekKeyOf.push(monday.toISOString().slice(0, 10));
      monthKeyOf.push(s.slice(0, 7));
    });
  }

  function fillFilters() {
    const desde = document.getElementById("f-desde");
    const hasta = document.getElementById("f-hasta");
    const dataMin = DATA.dims.fechas[0];
    const dataMax = DATA.dims.fechas[DATA.dims.fechas.length - 1];
    desde.min = hasta.min = dataMin;
    desde.max = hasta.max = dataMax;

    // Rango por defecto: el mes calendario anterior al de HOY (fecha real
    // del dispositivo), no el ultimo mes con datos. Ej: si hoy es
    // septiembre, por defecto muestra 1-31 de agosto.
    const hoy = new Date();
    const primerDiaMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMesAnterior = new Date(primerDiaMesActual - 86400000);
    const primerDiaMesAnterior = new Date(ultimoDiaMesAnterior.getFullYear(), ultimoDiaMesAnterior.getMonth(), 1);
    const toISO = (d) => d.toISOString().slice(0, 10);
    let defDesde = toISO(primerDiaMesAnterior);
    let defHasta = toISO(ultimoDiaMesAnterior);
    // proteccion: si el mes anterior cae fuera del rango de datos disponibles,
    // usar el rango completo de datos en su lugar.
    if (defHasta < dataMin || defDesde > dataMax) {
      defDesde = dataMin;
      defHasta = dataMax;
    } else {
      if (defDesde < dataMin) defDesde = dataMin;
      if (defHasta > dataMax) defHasta = dataMax;
    }
    desde.value = defDesde;
    hasta.value = defHasta;
    state.minDateIdx = lowerBound(DATA.dims.fechas, defDesde);
    state.maxDateIdx = upperBoundIdx(DATA.dims.fechas, defHasta);

    fillSelect("f-zona", DATA.dims.zonas);
    fillSelect("f-linea", DATA.dims.lineas);
    fillSelect("f-asesor", DATA.dims.asesores);
  }
  function fillSelect(id, arr) {
    const sel = document.getElementById(id);
    const items = arr.map((v, i) => [v, i]).sort((a, b) => a[0].localeCompare(b[0], "es"));
    items.forEach(([v, i]) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  }

  function bindEvents() {
    document.getElementById("f-desde").addEventListener("change", onDateChange);
    document.getElementById("f-hasta").addEventListener("change", onDateChange);
    document.getElementById("f-zona").addEventListener("change", (e) => { state.zona = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-linea").addEventListener("change", (e) => { state.linea = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-asesor").addEventListener("change", (e) => { state.asesor = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("btn-reset").addEventListener("click", resetFiltros);

    document.querySelectorAll("#chip-agrupacion button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#chip-agrupacion button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.agrupacion = b.dataset.mode;
        recomputeAndRender();
      });
    });

    document.getElementById("rg-search").addEventListener("input", (e) => {
      renderRealGeneral(DATA.real_general, e.target.value.trim().toLowerCase());
    });
    document.getElementById("cli-search").addEventListener("input", () => { cliShown = 20; renderClientesTable(); });
    document.getElementById("fam-search").addEventListener("input", () => { famShown = 20; renderFamiliasTable(); });
    document.getElementById("cli-more").addEventListener("click", () => { cliShown += 30; renderClientesTable(); });
    document.getElementById("fam-more").addEventListener("click", () => { famShown += 30; renderFamiliasTable(); });
  }

  function onDateChange() {
    const desdeVal = document.getElementById("f-desde").value;
    const hastaVal = document.getElementById("f-hasta").value;
    state.minDateIdx = lowerBound(DATA.dims.fechas, desdeVal);
    state.maxDateIdx = upperBoundIdx(DATA.dims.fechas, hastaVal);
    recomputeAndRender();
  }
  function lowerBound(arr, val) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < val) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function upperBoundIdx(arr, val) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= val) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  function resetFiltros() {
    state.zona = -1; state.linea = -1; state.asesor = -1;
    document.getElementById("f-zona").value = "";
    document.getElementById("f-linea").value = "";
    document.getElementById("f-asesor").value = "";
    document.getElementById("f-desde").value = DATA.dims.fechas[0];
    document.getElementById("f-hasta").value = DATA.dims.fechas[DATA.dims.fechas.length - 1];
    state.minDateIdx = 0; state.maxDateIdx = DATA.dims.fechas.length - 1;
    recomputeAndRender();
  }

  // =========================================================
  //  KPIs (no dependen de filtros, vienen de REAL GENERAL)
  // =========================================================
  function fillKpis() {
    const k = DATA.kpis;
    const grid = document.getElementById("kpi-grid");
    const mesNombre = cap((k.mes_nombre || "").toString());
    grid.innerHTML = "";
    grid.appendChild(kpiCard(mesNombre + "-" + String(k.anio).slice(-2), [
      ["Facturado", fmtCOP(k.mes.facturado)],
      ["Cuota", fmtCOP(k.mes.cuota)],
    ], k.mes.diferencia, k.mes.cumplimiento));

    grid.appendChild(kpiCard(String(k.anio) + " (YTD)", [
      ["Facturado", fmtCOP(k.ytd.facturado)],
      ["Cuota", fmtCOP(k.ytd.cuota)],
    ], k.ytd.diferencia, k.ytd.cumplimiento));

    grid.appendChild(kpiCard(mesNombre + "-" + String(k.anio - 1).slice(-2), [
      ["Facturado año anterior", fmtCOP(k.mes_anterior_anio.facturado)],
    ], null, null, {
      label: "$ Crecimiento", value: k.mes_anterior_anio.crecimiento_abs, pct: k.mes_anterior_anio.crecimiento_pct
    }));

    grid.appendChild(kpiCard("YTD " + String(k.anio - 1), [
      ["Facturado YTD año anterior", fmtCOP(k.ytd_anterior_anio.facturado)],
    ], null, null, {
      label: "$ Crecimiento", value: k.ytd_anterior_anio.crecimiento_abs, pct: k.ytd_anterior_anio.crecimiento_pct
    }));
  }

  function kpiCard(title, rows, diferencia, cumplimiento, crecimiento) {
    const div = document.createElement("div");
    div.className = "kpi-card";
    let html = '<div class="kpi-card__label">Periodo</div><div class="kpi-card__title">' + title + "</div>";
    rows.forEach(([k, v]) => {
      html += '<div class="kpi-row"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>";
    });
    if (diferencia !== null && diferencia !== undefined) {
      const cls = diferencia >= 0 ? "pos" : "neg";
      const sign = diferencia >= 0 ? "+" : "-";
      html += '<div class="kpi-diff"><span class="k">$ Diferencia</span><span class="v ' + cls + '">' + sign + fmtCOP(Math.abs(diferencia)) + "</span></div>";
    }
    if (cumplimiento !== null && cumplimiento !== undefined) {
      const pct = Math.max(0, Math.min(1, cumplimiento));
      const ok = cumplimiento >= 1;
      html += '<div class="progress"><span class="' + (ok ? "ok" : "") + '" style="width:' + (pct * 100) + '%"></span></div>';
      html += '<span class="kpi-pct ' + (cumplimiento >= 1 ? "pos" : cumplimiento >= 0.9 ? "" : "neg") + '">' + fmtPct(cumplimiento) + " cumplimiento</span>";
    }
    if (crecimiento) {
      const cls = crecimiento.value >= 0 ? "pos" : "neg";
      const sign = crecimiento.value >= 0 ? "+" : "-";
      html += '<div class="kpi-diff"><span class="k">' + crecimiento.label + '</span><span class="v ' + cls + '">' + sign + fmtCOP(Math.abs(crecimiento.value)) + "</span></div>";
      html += '<span class="kpi-pct ' + cls + '">' + (crecimiento.pct >= 0 ? "+" : "") + fmtPct(crecimiento.pct) + " crecimiento</span>";
    }
    div.innerHTML = html;
    return div;
  }

  // =========================================================
  //  Motor de agregacion sobre "facts"
  //  facts[i] = [dateIdx, zonaIdx, lineaIdx, asesorIdx, familiaIdx, clienteIdx, valor, cantidad]
  // =========================================================
  function computeAggregates() {
    const { minDateIdx, maxDateIdx, zona, linea, asesor, agrupacion } = state;
    const facts = DATA.facts;
    const byZona = new Map(), byLinea = new Map(), byFamilia = new Map(), byCliente = new Map();
    const byBucket = new Map();
    let total = 0, cantidad = 0, transacciones = 0;

    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const di = f[0];
      if (di < minDateIdx || di > maxDateIdx) continue;
      if (zona !== -1 && f[1] !== zona) continue;
      if (linea !== -1 && f[2] !== linea) continue;
      if (asesor !== -1 && f[3] !== asesor) continue;

      const val = f[6], cant = f[7];
      total += val; cantidad += cant; transacciones++;

      addTo(byZona, f[1], val);
      addTo(byLinea, f[2], val);
      addTo(byFamilia, f[4], val);
      addTo(byCliente, f[5], val);

      let bucketKey;
      if (agrupacion === "day") bucketKey = DATA.dims.fechas[di];
      else if (agrupacion === "month") bucketKey = monthKeyOf[di];
      else bucketKey = weekKeyOf[di];
      addTo(byBucket, bucketKey, val);
    }
    return { total, cantidad, transacciones, byZona, byLinea, byFamilia, byCliente, byBucket };
  }
  function addTo(map, key, val) { map.set(key, (map.get(key) || 0) + val); }

  function sortedEntries(map, namesArr) {
    return [...map.entries()]
      .map(([idx, val]) => [namesArr ? namesArr[idx] : idx, val])
      .sort((a, b) => b[1] - a[1]);
  }

  let lastAgg = null;

  function recomputeAndRender() {
    const agg = computeAggregates();
    lastAgg = agg;
    updateFilterStatus(agg);
    renderEvolucion(agg);
    renderLineas(agg);
    renderZonas(agg);
    cliShown = 20; famShown = 20;
    renderClientesTable();
    renderFamiliasTable();
  }

  function updateFilterStatus(agg) {
    document.getElementById("filter-status").innerHTML =
      "<b>" + fmtInt(agg.transacciones) + "</b> registros filtrados";
  }

  // ---------------- Evolucion ----------------
  function renderEvolucion(agg) {
    document.getElementById("ev-total").textContent = fmtCOP(agg.total);
    document.getElementById("ev-unidades").textContent = fmtInt(agg.cantidad);
    document.getElementById("ev-transacciones").textContent = fmtInt(agg.transacciones);
    document.getElementById("ev-ticket").textContent = fmtCOP(agg.transacciones ? agg.total / agg.transacciones : 0);

    const entries = [...agg.byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const labels = entries.map(([k]) => formatBucketLabel(k));
    const values = entries.map(([, v]) => v);

    renderChart("chart-evolucion", "line", {
      labels,
      datasets: [{
        label: "Facturación",
        data: values,
        borderColor: COLORS.rojo,
        backgroundColor: "rgba(228,55,51,.18)",
        fill: true,
        tension: 0.25,
        pointRadius: labels.length > 40 ? 0 : 2,
        borderWidth: 2,
      }],
    }, {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#C6C7C8", maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { ticks: { color: "#C6C7C8", callback: (v) => fmtCOPShort(v) }, grid: { color: "rgba(255,255,255,.08)" } },
      },
    });
  }
  function formatBucketLabel(key) {
    if (state.agrupacion === "month") {
      const [y, m] = key.split("-");
      const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      return meses[+m - 1] + " " + y.slice(2);
    }
    const d = new Date(key + "T00:00:00");
    return d.getDate() + "/" + (d.getMonth() + 1);
  }

  // ---------------- Lineas ----------------
  function renderLineas(agg) {
    const entries = sortedEntries(agg.byLinea, DATA.dims.lineas);
    const labels = entries.map((e) => e[0]);
    const values = entries.map((e) => e[1]);
    renderChart("chart-lineas", "bar", {
      labels,
      datasets: [{ label: "Facturación", data: values, backgroundColor: COLORS.rojo, borderRadius: 4 }],
    }, {
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtCOP(c.parsed.x) } } },
      scales: {
        x: { ticks: { callback: (v) => fmtCOPShort(v) }, grid: { color: "#ECEDED" } },
        y: { grid: { display: false } },
      },
    });

    const tbody = document.querySelector("#tabla-lineas tbody");
    tbody.innerHTML = "";
    entries.forEach(([name, val]) => {
      const pct = agg.total ? val / agg.total : 0;
      tbody.innerHTML += `<tr><td>${escapeHtml(name)}</td><td class="num">${fmtCOP(val)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
    });
    if (!entries.length) tbody.innerHTML = emptyRow(3);
  }

  // ---------------- Zonas ----------------
  function renderZonas(agg) {
    const entries = sortedEntries(agg.byZona, DATA.dims.zonas);
    const labels = entries.map((e) => e[0]);
    const values = entries.map((e) => e[1]);
    renderChart("chart-zonas", "doughnut", {
      labels,
      datasets: [{ data: values, backgroundColor: LINEA_PALETTE, borderWidth: 2, borderColor: "#fff" }],
    }, {
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, color: "#4B4B4B", font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => c.label + ": " + fmtCOP(c.parsed) } },
      },
      cutout: "62%",
    });

    const cont = document.getElementById("zona-cards");
    cont.innerHTML = "";
    entries.forEach(([name, val], i) => {
      const pct = agg.total ? val / agg.total : 0;
      cont.innerHTML += `<div class="zona-card">
        <div class="zona-card__top">
          <span><span class="zona-card__dot" style="background:${LINEA_PALETTE[i % LINEA_PALETTE.length]}"></span>${escapeHtml(name)}</span>
        </div>
        <span class="zona-card__val">${fmtCOP(val)}</span>
        <span class="zona-card__pct">${fmtPct(pct)} del total filtrado</span>
      </div>`;
    });
    if (!entries.length) cont.innerHTML = '<p class="empty-msg">Sin datos para el filtro actual.</p>';
  }

  // ---------------- Clientes ----------------
  function renderClientesTable() {
    const agg = lastAgg;
    const q = document.getElementById("cli-search").value.trim().toLowerCase();
    let entries = sortedEntries(agg.byCliente, DATA.dims.clientes);
    if (q) entries = entries.filter((e) => e[0].toLowerCase().includes(q));
    const tbody = document.querySelector("#tabla-clientes tbody");
    tbody.innerHTML = "";
    entries.slice(0, cliShown).forEach(([name, val], i) => {
      const pct = agg.total ? val / agg.total : 0;
      tbody.innerHTML += `<tr><td class="rank">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${fmtCOP(val)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
    });
    if (!entries.length) tbody.innerHTML = emptyRow(4);
    document.getElementById("cli-more").style.display = entries.length > cliShown ? "block" : "none";
  }

  // ---------------- Familias ----------------
  function renderFamiliasTable() {
    const agg = lastAgg;
    const q = document.getElementById("fam-search").value.trim().toLowerCase();
    let entries = sortedEntries(agg.byFamilia, DATA.dims.familias);
    if (q) entries = entries.filter((e) => e[0].toLowerCase().includes(q));
    const tbody = document.querySelector("#tabla-familias tbody");
    tbody.innerHTML = "";
    entries.slice(0, famShown).forEach(([name, val], i) => {
      const pct = agg.total ? val / agg.total : 0;
      tbody.innerHTML += `<tr><td class="rank">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${fmtCOP(val)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
    });
    if (!entries.length) tbody.innerHTML = emptyRow(4);
    document.getElementById("fam-more").style.display = entries.length > famShown ? "block" : "none";
  }

  // =========================================================
  //  Tabla "REAL GENERAL" (cuota vs realizado) — estatica
  // =========================================================
  function renderRealGeneral(rows, q) {
    q = (q || "").toLowerCase();
    const tbody = document.querySelector("#tabla-real-general tbody");
    tbody.innerHTML = "";
    rows.forEach((r) => {
      if (r.tipo === "espacio") {
        if (!q) tbody.innerHTML += `<tr class="row-espacio"><td colspan="11"></td></tr>`;
        return;
      }
      const hay = ((r.zona || "") + " " + (r.representante || "") + " " + (r.gerente || "")).toLowerCase();
      if (q && !hay.includes(q)) return;
      const tr = document.createElement("tr");
      tr.className = "row-" + r.tipo;
      const okCum = r.cumplimiento !== null && r.cumplimiento >= 1;
      const diffCls = r.diferencia === null || r.diferencia === undefined ? "" : (r.diferencia >= 0 ? "pos" : "neg");
      const nameCell = r.tipo === "representante" ? `<td class="indent">${escapeHtml(r.representante || "—")}</td>` : `<td>${escapeHtml(r.representante || "—")}</td>`;
      const cumCell = (r.cumplimiento === null || r.cumplimiento === undefined || r.sin_cuota)
        ? `<span title="Sin cuota asignada">s/cuota</span>`
        : `<span class="mini-bar"><span class="${okCum ? "ok" : ""}" style="width:${Math.max(0, Math.min(100, r.cumplimiento * 100))}%"></span></span>${fmtPct(r.cumplimiento)}`;
      const diffCell = r.diferencia === null || r.diferencia === undefined ? "—" : fmtCOP(r.diferencia);
      const semanas = r.semanas || [null, null, null, null, null];
      const semCells = semanas.map((s) => `<td class="num">${s === null || s === undefined ? "—" : fmtCOPShort(s)}</td>`).join("");
      tr.innerHTML = `
        <td>${escapeHtml(r.zona || "—")}</td>
        ${nameCell}
        <td class="num">${r.cuota ? fmtCOP(r.cuota) : "—"}</td>
        <td class="num">${fmtCOP(r.realizado)}</td>
        <td class="num">${cumCell}</td>
        <td class="num ${r.tipo === "total_zona" || r.tipo === "total_general" ? "" : diffCls}">${diffCell}</td>
        ${semCells}`;
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) tbody.innerHTML = emptyRow(11);
  }

  // =========================================================
  //  Utilidades
  // =========================================================
  function renderChart(canvasId, type, data, options) {
    const ctx = document.getElementById(canvasId).getContext("2d");
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(ctx, {
      type, data,
      options: Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 260 } }, options),
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function emptyRow(cols) { return `<tr><td colspan="${cols}" class="empty-msg">Sin datos para el filtro actual.</td></tr>`; }

  function setupScrollSpy() {
    const links = [...document.querySelectorAll(".sectionnav a")];
    const sections = links.map((l) => document.querySelector(l.getAttribute("href")));
    window.addEventListener("scroll", () => {
      let idx = 0;
      const y = window.scrollY + 140;
      sections.forEach((s, i) => { if (s && s.offsetTop <= y) idx = i; });
      links.forEach((l, i) => l.classList.toggle("active", i === idx));
    }, { passive: true });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { Object.values(charts).forEach((c) => c.resize()); }, 150);
  });
})();
