/* =========================================================
   Fagron · Dashboard Ejecutivo de Ventas — app.js (v3)
   Lee data.json (generado por data_pipeline/build_data.py)
   y controla filtros, tablas y graficos. No requiere backend.
   TODO en este archivo responde a los filtros: fecha (desde/hasta),
   zona, linea, asesor, cliente y familia.
   ========================================================= */
(function () {
  "use strict";

  const COLORS = {
    rojo: "#E43733", rojoOsc: "#C22521", grisOsc: "#4B4B4B", gris: "#9C9E9F",
    grisClaro: "#C6C7C8", grisBg: "#ECEDED", salmon: "#F5AA9A", negro: "#000000",
    verde: "#1E8A5F", amarillo: "#F2A93B", azul: "#3E8FD6"
  };
  const LINEA_PALETTE = ["#E43733", "#4B4B4B", "#F5AA9A", "#9C9E9F", "#1E8A5F", "#C6C7C8", "#C22521", "#8a8c8d"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

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
  const cap = (s) => (s && s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
  const fmtDMY = (iso) => { const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y; };

  function shiftYearStr(iso, delta) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y + delta, m - 1, d);
    if (dt.getMonth() !== m - 1) dt.setDate(0); // 29-feb en anio no bisiesto -> ultimo dia del mes anterior
    const pad = (n) => String(n).padStart(2, "0");
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }
  function periodoLabel(desdeStr, hastaStr) {
    const d0 = new Date(desdeStr + "T00:00:00"), d1 = new Date(hastaStr + "T00:00:00");
    if (d0.getFullYear() === d1.getFullYear() && d0.getMonth() === d1.getMonth()) {
      return cap(MESES[d0.getMonth()]) + " " + d0.getFullYear();
    }
    return fmtDMY(desdeStr) + " – " + fmtDMY(hastaStr);
  }
  function monthsOverlapped(desdeStr, hastaStr) {
    const d0 = new Date(desdeStr + "T00:00:00"), d1 = new Date(hastaStr + "T00:00:00");
    const out = [];
    let y = d0.getFullYear(), m = d0.getMonth();
    let guard = 0;
    while ((y < d1.getFullYear() || (y === d1.getFullYear() && m <= d1.getMonth())) && guard < 600) {
      out.push({ year: y, month: m + 1 });
      m++; if (m > 11) { m = 0; y++; }
      guard++;
    }
    return out;
  }
  function cuotaSumForRow(cuotaPorMes, desdeStr, hastaStr) {
    if (!cuotaPorMes) return 0;
    let s = 0;
    monthsOverlapped(desdeStr, hastaStr).forEach(({ year, month }) => {
      if (year === 2026) s += (cuotaPorMes[month - 1] || 0);
    });
    return s;
  }
  function semanasSumForRow(semanasPorMes, desdeStr, hastaStr) {
    const out = [0, 0, 0, 0, 0];
    if (!semanasPorMes) return out;
    monthsOverlapped(desdeStr, hastaStr).forEach(({ year, month }) => {
      const key = year + "-" + String(month).padStart(2, "0");
      const wk = semanasPorMes[key];
      if (wk) for (let k = 0; k < 5; k++) out[k] += wk[k];
    });
    return out;
  }

  let DATA = null;
  let charts = {};

  // ---- estado de filtros (indices, -1 = todos) ----
  const state = {
    zona: -1, linea: -1, asesor: -1, cliente: -1, familia: -1,
    minDateIdx: 0, maxDateIdx: 0, agrupacion: "week",
    evolToggles: { facturacion: true, unidades: false, transacciones: false, ticket: false },
    selectedCliente: -1, selectedFamilia: -1,
  };

  let cliShown = 20, famShown = 20;

  const dataPromise = window.__DASHBOARD_DATA__
    ? Promise.resolve(window.__DASHBOARD_DATA__)
    : fetch("data.json").then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar data.json (" + r.status + ")");
        return r.json();
      });

  dataPromise
    .then((json) => { DATA = json; init(); })
    .catch((err) => {
      document.getElementById("loading").innerHTML =
        '<p style="max-width:360px;text-align:center;font-size:13px;color:#E43733;">No se pudo cargar <b>data.json</b>. Verifica que el archivo esté en la misma carpeta que index.html.<br><br>' +
        String(err.message || err) + "</p>";
    });

  function init() {
    precomputeDateKeys();
    fillMeta();
    fillFilters();
    bindEvents();
    recomputeAndRender();
    setupScrollSpy();
    setupScrollTopBtn();
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

  let weekKeyOf = [], monthKeyOf = [];
  function precomputeDateKeys() {
    DATA.dims.fechas.forEach((s) => {
      const d = new Date(s + "T00:00:00");
      const day = (d.getDay() + 6) % 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - day);
      weekKeyOf.push(monday.toISOString().slice(0, 10));
      monthKeyOf.push(s.slice(0, 7));
    });
  }

  // Rango por defecto: el mes calendario anterior al de HOY (fecha real del
  // dispositivo). Ej: si hoy es 4 de septiembre, por defecto 1-31 agosto.
  function defaultDateRange() {
    const dataMin = DATA.dims.fechas[0];
    const dataMax = DATA.dims.fechas[DATA.dims.fechas.length - 1];
    const hoy = new Date();
    const primerDiaMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMesAnterior = new Date(primerDiaMesActual - 86400000);
    const primerDiaMesAnterior = new Date(ultimoDiaMesAnterior.getFullYear(), ultimoDiaMesAnterior.getMonth(), 1);
    const toISO = (d) => d.toISOString().slice(0, 10);
    let desde = toISO(primerDiaMesAnterior);
    let hasta = toISO(ultimoDiaMesAnterior);
    if (hasta < dataMin || desde > dataMax) { desde = dataMin; hasta = dataMax; }
    else { if (desde < dataMin) desde = dataMin; if (hasta > dataMax) hasta = dataMax; }
    return { desde, hasta };
  }

  function fillFilters() {
    const desde = document.getElementById("f-desde");
    const hasta = document.getElementById("f-hasta");
    desde.min = hasta.min = DATA.dims.fechas[0];
    desde.max = hasta.max = DATA.dims.fechas[DATA.dims.fechas.length - 1];

    const def = defaultDateRange();
    desde.value = def.desde;
    hasta.value = def.hasta;
    state.minDateIdx = lowerBound(DATA.dims.fechas, def.desde);
    state.maxDateIdx = upperBoundIdx(DATA.dims.fechas, def.hasta);

    fillSelect("f-zona", DATA.dims.zonas);
    fillSelect("f-linea", DATA.dims.lineas);
    fillSelect("f-asesor", DATA.dims.asesores);
    fillSelect("f-cliente", DATA.dims.clientes);
    fillSelect("f-familia", DATA.dims.familias);
  }
  function fillSelect(id, arr) {
    const sel = document.getElementById(id);
    const items = arr.map((v, i) => [v, i]).sort((a, b) => a[0].localeCompare(b[0], "es"));
    const frag = document.createDocumentFragment();
    items.forEach(([v, i]) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = v;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);
  }

  function bindEvents() {
    document.getElementById("f-desde").addEventListener("change", onDateChange);
    document.getElementById("f-hasta").addEventListener("change", onDateChange);
    document.getElementById("f-zona").addEventListener("change", (e) => { state.zona = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-linea").addEventListener("change", (e) => { state.linea = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-asesor").addEventListener("change", (e) => { state.asesor = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-cliente").addEventListener("change", (e) => { state.cliente = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("f-familia").addEventListener("change", (e) => { state.familia = e.target.value === "" ? -1 : +e.target.value; recomputeAndRender(); });
    document.getElementById("btn-reset").addEventListener("click", resetFiltros);

    document.querySelectorAll("#chip-agrupacion button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#chip-agrupacion button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.agrupacion = b.dataset.mode;
        lastAgg = aggregateRange(state.minDateIdx, state.maxDateIdx, { conBuckets: true });
        renderEvolucion(lastAgg);
      });
    });
    document.querySelectorAll(".stat-toggle, .evol-legend__chip").forEach((b) => {
      b.addEventListener("click", () => toggleSerie(b.dataset.serie));
    });

    document.getElementById("rg-search").addEventListener("input", (e) => {
      renderRealGeneral(lastCumplimientoRows, e.target.value.trim().toLowerCase());
    });
    document.getElementById("cli-search").addEventListener("input", () => { cliShown = 20; renderClientesTable(); });
    document.getElementById("fam-search").addEventListener("input", () => { famShown = 20; renderFamiliasTable(); });
    document.getElementById("cli-more").addEventListener("click", () => { cliShown += 30; renderClientesTable(); });
    document.getElementById("fam-more").addEventListener("click", () => { famShown += 30; renderFamiliasTable(); });
    document.querySelector("#tabla-clientes tbody").addEventListener("click", onClienteRowClick);
    document.querySelector("#tabla-familias tbody").addEventListener("click", onFamiliaRowClick);
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
    state.zona = -1; state.linea = -1; state.asesor = -1; state.cliente = -1; state.familia = -1;
    state.selectedCliente = -1; state.selectedFamilia = -1;
    document.getElementById("f-zona").value = "";
    document.getElementById("f-linea").value = "";
    document.getElementById("f-asesor").value = "";
    document.getElementById("f-cliente").value = "";
    document.getElementById("f-familia").value = "";
    const def = defaultDateRange();
    document.getElementById("f-desde").value = def.desde;
    document.getElementById("f-hasta").value = def.hasta;
    state.minDateIdx = lowerBound(DATA.dims.fechas, def.desde);
    state.maxDateIdx = upperBoundIdx(DATA.dims.fechas, def.hasta);
    recomputeAndRender();
  }

  // =========================================================
  //  Motor de agregacion sobre "facts"
  //  facts[i] = [dateIdx, zonaIdx, lineaIdx, asesorIdx, familiaIdx, clienteIdx, valor, cantidad]
  // =========================================================
  function aggregateRange(minDateIdx, maxDateIdx, opts) {
    opts = opts || {};
    const conBuckets = !!opts.conBuckets;
    const { linea, cliente, familia } = state;
    const asesorSet = asesorSetForFilters(); // unifica "zona" + "asesor" por identidad del representante
    const facts = DATA.facts;
    const byZona = new Map(), byLinea = new Map(), byFamilia = new Map(), byCliente = new Map(), byAsesor = new Map();
    const byBucket = new Map(); // key -> {val, cant, count}
    let total = 0, cantidad = 0, transacciones = 0;

    if (maxDateIdx < minDateIdx) return { total, cantidad, transacciones, byZona, byLinea, byFamilia, byCliente, byAsesor, byBucket };

    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const di = f[0];
      if (di < minDateIdx || di > maxDateIdx) continue;
      if (asesorSet && !asesorSet.has(f[3])) continue;
      if (linea !== -1 && f[2] !== linea) continue;
      if (familia !== -1 && f[4] !== familia) continue;
      if (cliente !== -1 && f[5] !== cliente) continue;

      const val = f[6], cant = f[7];
      total += val; cantidad += cant; transacciones++;

      addTo(byZona, f[1], val);
      addTo(byLinea, f[2], val);
      addTo(byFamilia, f[4], val);
      addTo(byCliente, f[5], val);
      addTo(byAsesor, f[3], val);

      if (conBuckets) {
        let bucketKey;
        if (state.agrupacion === "day") bucketKey = DATA.dims.fechas[di];
        else if (state.agrupacion === "month") bucketKey = monthKeyOf[di];
        else if (state.agrupacion === "year") bucketKey = DATA.dims.fechas[di].slice(0, 4);
        else bucketKey = weekKeyOf[di];
        let b = byBucket.get(bucketKey);
        if (!b) { b = { val: 0, cant: 0, count: 0 }; byBucket.set(bucketKey, b); }
        b.val += val; b.cant += cant; b.count += 1;
      }
    }
    return { total, cantidad, transacciones, byZona, byLinea, byFamilia, byCliente, byAsesor, byBucket };
  }
  function addTo(map, key, val) { map.set(key, (map.get(key) || 0) + val); }

  // Conjunto de indices de asesor que pertenecen al filtro de zona/asesor
  // vigente, segun la hoja CUOTAS 2026 (zona del REPRESENTANTE, no de la
  // transaccion). Devuelve null si no hay filtro de zona ni de asesor
  // (=> no restringe por representante).
  function asesorSetForFilters() {
    if (state.zona === -1 && state.asesor === -1) return null;
    const zonaSelNombre = state.zona === -1 ? null : DATA.dims.zonas[state.zona];
    const reps = DATA.real_general.filter((r) => r.tipo === "representante");
    const matching = reps.filter((r) =>
      (zonaSelNombre === null || r.zona === zonaSelNombre) &&
      (state.asesor === -1 || r.asesor_idx === state.asesor)
    );
    return new Set(matching.map((r) => r.asesor_idx).filter((x) => x != null));
  }

  // Agregacion "por representante": para el Resumen ejecutivo y la tabla de
  // Cumplimiento, el filtro de Zona/Asesor debe significar "zona/asesor DEL
  // REPRESENTANTE" (segun CUOTAS 2026), no la zona de la transaccion — son
  // dimensiones distintas en el Excel y no siempre coinciden 1 a 1. Linea,
  // cliente y familia si se filtran por su propio campo, como siempre.
  function aggregateRangeByRepScope(minDateIdx, maxDateIdx) {
    const asesorSet = asesorSetForFilters();
    const { linea, cliente, familia } = state;
    const facts = DATA.facts;
    const byAsesor = new Map();
    let total = 0, cantidad = 0, transacciones = 0;
    if (maxDateIdx < minDateIdx) return { total, cantidad, transacciones, byAsesor };
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const di = f[0];
      if (di < minDateIdx || di > maxDateIdx) continue;
      if (asesorSet && !asesorSet.has(f[3])) continue;
      if (linea !== -1 && f[2] !== linea) continue;
      if (familia !== -1 && f[4] !== familia) continue;
      if (cliente !== -1 && f[5] !== cliente) continue;
      const val = f[6], cant = f[7];
      total += val; cantidad += cant; transacciones++;
      addTo(byAsesor, f[3], val);
    }
    return { total, cantidad, transacciones, byAsesor };
  }

  function sortedEntries(map, namesArr) {
    return [...map.entries()]
      .map(([idx, val]) => [namesArr ? namesArr[idx] : idx, val])
      .sort((a, b) => b[1] - a[1]);
  }
  // igual que sortedEntries pero conservando el indice original (idx, nombre, valor)
  function sortedEntriesIdx(map, namesArr) {
    return [...map.entries()]
      .map(([idx, val]) => [idx, namesArr[idx], val])
      .sort((a, b) => b[2] - a[2]);
  }

  // Agregacion cruzada: totales de "groupField" (4=familia, 5=cliente)
  // restringidos ademas a un valor fijo de "fixedField" (5=cliente, 4=familia),
  // respetando todos los filtros globales vigentes (fecha/zona/asesor/linea/
  // cliente/familia). Se usa para la seleccion cliente<->familia.
  function aggregateCrossFilter(fixedField, fixedIdx, groupField) {
    const asesorSet = asesorSetForFilters();
    const { linea, cliente, familia } = state;
    const facts = DATA.facts;
    const map = new Map();
    let total = 0;
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      const di = f[0];
      if (di < state.minDateIdx || di > state.maxDateIdx) continue;
      if (asesorSet && !asesorSet.has(f[3])) continue;
      if (linea !== -1 && f[2] !== linea) continue;
      if (familia !== -1 && f[4] !== familia) continue;
      if (cliente !== -1 && f[5] !== cliente) continue;
      if (f[fixedField] !== fixedIdx) continue;
      addTo(map, f[groupField], f[6]);
      total += f[6];
    }
    return { map, total };
  }

  // suma la cuota (de una lista de representantes ya filtrada por zona/asesor)
  // para los meses de 2026 que el rango [desdeStr,hastaStr] toca.
  function filteredCuotaSum(reps, desdeStr, hastaStr) {
    return reps.reduce((s, r) => s + cuotaSumForRow(r.cuota_por_mes, desdeStr, hastaStr), 0);
  }

  let lastAgg = null;
  let lastCumplimientoRows = [];

  function recomputeAndRender() {
    const desdeStr = document.getElementById("f-desde").value;
    const hastaStr = document.getElementById("f-hasta").value;
    const agg = aggregateRange(state.minDateIdx, state.maxDateIdx, { conBuckets: true });
    lastAgg = agg;
    const repAgg = aggregateRangeByRepScope(state.minDateIdx, state.maxDateIdx);

    updateFilterStatus(agg);
    updatePeriodoBadges(desdeStr, hastaStr);
    updateKpis(repAgg, desdeStr, hastaStr);
    renderEvolucion(agg);
    renderLineas(agg);
    renderZonas(agg);
    cliShown = 20; famShown = 20;
    renderClientesTable();
    renderFamiliasTable();

    lastCumplimientoRows = buildCumplimientoRows(repAgg, desdeStr, hastaStr);
    renderRealGeneral(lastCumplimientoRows, document.getElementById("rg-search").value.trim().toLowerCase());
  }

  function updateFilterStatus(agg) {
    document.getElementById("filter-status").innerHTML =
      "<b>" + fmtInt(agg.transacciones) + "</b> registros filtrados";
  }
  function updatePeriodoBadges(desdeStr, hastaStr) {
    const label = fmtDMY(desdeStr) + " – " + fmtDMY(hastaStr);
    ["periodo-lineas", "periodo-zonas", "periodo-clifam", "periodo-cumplimiento", "periodo-evolucion"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
    });
    document.getElementById("ev-titulo").textContent = "Facturación " + label;
  }

  // =========================================================
  //  KPIs — 100% dinamicos segun filtros (fecha + zona + linea +
  //  asesor + cliente + familia). La cuota sale de CUOTAS 2026
  //  (solo existe para el anio 2026 y no distingue linea/cliente/
  //  familia); el facturado sale siempre de Data 2025-2026.
  // =========================================================
  function updateKpis(mesAgg, desdeStr, hastaStr) {
    const yearHasta = +hastaStr.slice(0, 4);
    const fechas = DATA.dims.fechas;

    const ytdDesde = yearHasta + "-01-01";
    const ytdMinIdx = lowerBound(fechas, ytdDesde);
    const ytdAgg = aggregateRangeByRepScope(ytdMinIdx, state.maxDateIdx);

    const lyDesde = shiftYearStr(desdeStr, -1), lyHasta = shiftYearStr(hastaStr, -1);
    const lyMinIdx = lowerBound(fechas, lyDesde), lyMaxIdx = upperBoundIdx(fechas, lyHasta);
    const lyAgg = aggregateRangeByRepScope(lyMinIdx, lyMaxIdx);

    const ytdLyDesde = (yearHasta - 1) + "-01-01";
    const ytdLyMinIdx = lowerBound(fechas, ytdLyDesde);
    const ytdLyAgg = aggregateRangeByRepScope(ytdLyMinIdx, lyMaxIdx);

    // representantes visibles segun filtro de zona/asesor (para la cuota)
    const reps = DATA.real_general.filter((r) => r.tipo === "representante");
    const zonaSelNombre = state.zona === -1 ? null : DATA.dims.zonas[state.zona];
    const repsFiltrados = reps.filter((r) =>
      (zonaSelNombre === null || r.zona === zonaSelNombre) &&
      (state.asesor === -1 || r.asesor_idx === state.asesor)
    );
    const mesCuota = filteredCuotaSum(repsFiltrados, desdeStr, hastaStr);
    const ytdCuota = filteredCuotaSum(repsFiltrados, ytdDesde, hastaStr);

    const mesFacturado = mesAgg.total, ytdFacturado = ytdAgg.total;
    const mesLY = lyAgg.total, ytdLY = ytdLyAgg.total;

    const grid = document.getElementById("kpi-grid");
    grid.innerHTML = "";

    grid.appendChild(kpiCard({
      label: "PERIODO", title: periodoLabel(desdeStr, hastaStr),
      rows: [["Facturado", fmtCOP(mesFacturado)], ["Cuota", fmtCOP(mesCuota)]],
      diferencia: mesFacturado - mesCuota,
      cumplimiento: mesCuota ? mesFacturado / mesCuota : null,
    }));

    grid.appendChild(kpiCard({
      label: "PERIODO", title: yearHasta + " (YTD)",
      rows: [["Facturado", fmtCOP(ytdFacturado)], ["Cuota", fmtCOP(ytdCuota)]],
      diferencia: ytdFacturado - ytdCuota,
      cumplimiento: ytdCuota ? ytdFacturado / ytdCuota : null,
    }));

    const critAbs = mesFacturado - mesLY;
    const critPct = mesLY ? critAbs / mesLY : null;
    grid.appendChild(kpiCard({
      label: "COMPARATIVO", title: periodoLabel(lyDesde, lyHasta),
      rows: [["Facturado", fmtCOP(mesLY)]],
      crecimiento: { abs: critAbs, pct: critPct },
    }));

    const critYtdAbs = ytdFacturado - ytdLY;
    const critYtdPct = ytdLY ? critYtdAbs / ytdLY : null;
    grid.appendChild(kpiCard({
      label: "COMPARATIVO", title: "YTD " + (yearHasta - 1),
      rows: [["Facturado YTD", fmtCOP(ytdLY)]],
      crecimiento: { abs: critYtdAbs, pct: critYtdPct },
    }));
  }

  function kpiRow(k, v, cls) {
    return '<div class="kpi-row"><span class="k">' + k + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
  }
  function kpiDiffRow(k, v, cls) {
    return '<div class="kpi-diff"><span class="k">' + k + '</span><span class="v ' + cls + '">' + v + "</span></div>";
  }

  function kpiCard(cfg) {
    const div = document.createElement("div");
    div.className = "kpi-card";
    let html = '<div class="kpi-card__label">' + cfg.label + '</div><div class="kpi-card__title">' + cfg.title + "</div>";
    (cfg.rows || []).forEach(([k, v]) => { html += kpiRow(k, v); });

    if (cfg.diferencia !== undefined && cfg.diferencia !== null) {
      const cls = cfg.diferencia >= 0 ? "pos" : "neg";
      const sign = cfg.diferencia >= 0 ? "+" : "-";
      html += kpiDiffRow("$ Diferencia", sign + fmtCOP(Math.abs(cfg.diferencia)), cls);
    }
    if (cfg.cumplimiento !== undefined && cfg.cumplimiento !== null) {
      const pct = Math.max(0, Math.min(1, cfg.cumplimiento));
      const ok = cfg.cumplimiento >= 1;
      html += '<div class="progress"><span class="' + (ok ? "ok" : "") + '" style="width:' + (pct * 100) + '%"></span></div>';
      html += '<span class="kpi-pct ' + (cfg.cumplimiento >= 1 ? "pos" : cfg.cumplimiento >= 0.9 ? "" : "neg") + '">' + fmtPct(cfg.cumplimiento) + " cumplimiento</span>";
    } else if (cfg.cumplimiento === null && cfg.diferencia !== undefined) {
      html += '<span class="kpi-pct">s/cuota en el periodo</span>';
    }
    if (cfg.crecimiento) {
      const cls = cfg.crecimiento.abs >= 0 ? "pos" : "neg";
      const sign = cfg.crecimiento.abs >= 0 ? "+" : "-";
      html += kpiDiffRow("$ Crecimiento", sign + fmtCOP(Math.abs(cfg.crecimiento.abs)), cls);
      const pctTxt = cfg.crecimiento.pct === null ? "s/d" : (cfg.crecimiento.pct >= 0 ? "+" : "-") + fmtPct(Math.abs(cfg.crecimiento.pct));
      html += kpiRow("% Crecimiento", pctTxt, cls);
    }
    div.innerHTML = html;
    return div;
  }

  function toggleSerie(serie) {
    state.evolToggles[serie] = !state.evolToggles[serie];
    document.querySelectorAll('[data-serie="' + serie + '"]').forEach((el) => {
      el.classList.toggle("on--" + serie, state.evolToggles[serie]);
      el.classList.toggle("is-on", state.evolToggles[serie]);
    });
    renderEvolucion(lastAgg);
  }

  // ---------------- Evolucion ----------------
  function renderEvolucion(agg) {
    document.getElementById("ev-total").textContent = fmtCOP(agg.total);
    document.getElementById("ev-unidades").textContent = fmtInt(agg.cantidad);
    document.getElementById("ev-transacciones").textContent = fmtInt(agg.transacciones);
    document.getElementById("ev-ticket").textContent = fmtCOP(agg.transacciones ? agg.total / agg.transacciones : 0);

    const entries = [...agg.byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const labels = entries.map(([k]) => formatBucketLabel(k));
    const valores = entries.map(([, v]) => v.val);
    const unidades = entries.map(([, v]) => v.cant);
    const transacciones = entries.map(([, v]) => v.count);
    const tickets = entries.map(([, v]) => (v.count ? v.val / v.count : 0));

    const datasets = [];
    if (state.evolToggles.facturacion) {
      datasets.push({
        label: "Facturación", data: valores, borderColor: COLORS.rojo, backgroundColor: "rgba(228,55,51,.18)",
        fill: true, tension: 0.25, pointRadius: labels.length > 40 ? 0 : 2, borderWidth: 2, yAxisID: "y",
      });
    }
    if (state.evolToggles.unidades) {
      datasets.push({ label: "Unidades", data: unidades, borderColor: COLORS.verde, backgroundColor: "transparent", tension: 0.25, pointRadius: labels.length > 40 ? 0 : 2, borderWidth: 2, yAxisID: "y1" });
    }
    if (state.evolToggles.transacciones) {
      datasets.push({ label: "Transacciones", data: transacciones, borderColor: COLORS.amarillo, backgroundColor: "transparent", tension: 0.25, pointRadius: labels.length > 40 ? 0 : 2, borderWidth: 2, yAxisID: "y1" });
    }
    if (state.evolToggles.ticket) {
      datasets.push({ label: "Ticket promedio", data: tickets, borderColor: COLORS.azul, backgroundColor: "transparent", tension: 0.25, pointRadius: labels.length > 40 ? 0 : 2, borderWidth: 2, yAxisID: "y1" });
    }

    const anySecundaria = state.evolToggles.unidades || state.evolToggles.transacciones || state.evolToggles.ticket;

    renderChart("chart-evolucion", "line", { labels, datasets }, {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#C6C7C8", maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { position: "left", display: state.evolToggles.facturacion, ticks: { color: "#C6C7C8", callback: (v) => fmtCOPShort(v) }, grid: { color: "rgba(255,255,255,.08)" } },
        y1: { position: "right", display: anySecundaria, ticks: { color: "#C6C7C8" }, grid: { display: false } },
      },
    });
  }
  function formatBucketLabel(key) {
    if (state.agrupacion === "year") return key;
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
    let total, entries;
    if (state.selectedFamilia !== -1) {
      const cf = aggregateCrossFilter(4, state.selectedFamilia, 5);
      entries = sortedEntriesIdx(cf.map, DATA.dims.clientes);
      total = cf.total;
    } else {
      entries = sortedEntriesIdx(agg.byCliente, DATA.dims.clientes);
      total = agg.total;
    }
    if (q) entries = entries.filter((e) => e[1].toLowerCase().includes(q));
    const tbody = document.querySelector("#tabla-clientes tbody");
    tbody.innerHTML = "";
    entries.slice(0, cliShown).forEach(([idx, name, val], i) => {
      const pct = total ? val / total : 0;
      const sel = idx === state.selectedCliente ? " row-selected" : "";
      tbody.innerHTML += `<tr class="row-selectable${sel}" data-idx="${idx}"><td class="rank">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${fmtCOP(val)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
    });
    if (!entries.length) tbody.innerHTML = emptyRow(4);
    document.getElementById("cli-more").style.display = entries.length > cliShown ? "block" : "none";
    document.getElementById("clientes-filtro-nota").style.display = state.selectedFamilia !== -1 ? "block" : "none";
  }

  // ---------------- Familias ----------------
  function renderFamiliasTable() {
    const agg = lastAgg;
    const q = document.getElementById("fam-search").value.trim().toLowerCase();
    let total, entries;
    if (state.selectedCliente !== -1) {
      const cf = aggregateCrossFilter(5, state.selectedCliente, 4);
      entries = sortedEntriesIdx(cf.map, DATA.dims.familias);
      total = cf.total;
    } else {
      entries = sortedEntriesIdx(agg.byFamilia, DATA.dims.familias);
      total = agg.total;
    }
    if (q) entries = entries.filter((e) => e[1].toLowerCase().includes(q));
    const tbody = document.querySelector("#tabla-familias tbody");
    tbody.innerHTML = "";
    entries.slice(0, famShown).forEach(([idx, name, val], i) => {
      const pct = total ? val / total : 0;
      const sel = idx === state.selectedFamilia ? " row-selected" : "";
      tbody.innerHTML += `<tr class="row-selectable${sel}" data-idx="${idx}"><td class="rank">${i + 1}</td><td>${escapeHtml(name)}</td><td class="num">${fmtCOP(val)}</td><td class="num">${fmtPct(pct)}</td></tr>`;
    });
    if (!entries.length) tbody.innerHTML = emptyRow(4);
    document.getElementById("fam-more").style.display = entries.length > famShown ? "block" : "none";
    document.getElementById("familias-filtro-nota").style.display = state.selectedCliente !== -1 ? "block" : "none";
  }

  function onClienteRowClick(e) {
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const idx = +tr.dataset.idx;
    state.selectedCliente = state.selectedCliente === idx ? -1 : idx;
    state.selectedFamilia = -1; // seleccion mutuamente excluyente
    famShown = 20; cliShown = 20;
    renderClientesTable();
    renderFamiliasTable();
  }
  function onFamiliaRowClick(e) {
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const idx = +tr.dataset.idx;
    state.selectedFamilia = state.selectedFamilia === idx ? -1 : idx;
    state.selectedCliente = -1;
    famShown = 20; cliShown = 20;
    renderClientesTable();
    renderFamiliasTable();
  }

  // =========================================================
  //  Tabla "Cumplimiento de cuota por zona y representante"
  //  100% dinamica: cuota = suma de los meses 2026 que toca el
  //  rango de fechas elegido (filtrada por zona/asesor); realizado
  //  = ventas reales del periodo exacto (respeta TODOS los filtros).
  // =========================================================
  function buildCumplimientoRows(agg, desdeStr, hastaStr) {
    const reps = DATA.real_general.filter((r) => r.tipo === "representante");
    const zonaSelNombre = state.zona === -1 ? null : DATA.dims.zonas[state.zona];
    const visibles = reps.filter((r) =>
      (zonaSelNombre === null || r.zona === zonaSelNombre) &&
      (state.asesor === -1 || r.asesor_idx === state.asesor)
    );

    const ordenZonas = [];
    const porZona = new Map();
    visibles.forEach((r) => {
      const z = r.zona || "—";
      if (!porZona.has(z)) { porZona.set(z, []); ordenZonas.push(z); }
      porZona.get(z).push(r);
    });

    const filas = [];
    let granCuota = 0, granRealizado = 0;
    ordenZonas.forEach((z, idx) => {
      if (idx > 0) filas.push({ tipo: "espacio" });
      let zCuota = 0, zRealizado = 0;
      porZona.get(z).forEach((r) => {
        const cuota = cuotaSumForRow(r.cuota_por_mes, desdeStr, hastaStr);
        const realizado = (r.asesor_idx != null ? agg.byAsesor.get(r.asesor_idx) : 0) || 0;
        const semanas = semanasSumForRow(r.semanas_por_mes, desdeStr, hastaStr);
        zCuota += cuota; zRealizado += realizado;
        filas.push({
          tipo: "representante", zona: z, representante: r.representante,
          cuota, realizado, semanas,
          diferencia: realizado - cuota,
          cumplimiento: cuota ? realizado / cuota : null,
          sin_cuota: !cuota,
        });
      });
      const zSemanas = [0, 0, 0, 0, 0];
      porZona.get(z).forEach((r) => {
        const s = semanasSumForRow(r.semanas_por_mes, desdeStr, hastaStr);
        for (let k = 0; k < 5; k++) zSemanas[k] += s[k];
      });
      filas.push({
        tipo: "total_zona", zona: z, representante: "TOTAL ZONA " + z,
        cuota: zCuota, realizado: zRealizado, semanas: zSemanas,
        diferencia: zRealizado - zCuota, cumplimiento: zCuota ? zRealizado / zCuota : null, sin_cuota: !zCuota,
      });
      granCuota += zCuota; granRealizado += zRealizado;
    });

    if (visibles.length) {
      const granSemanas = [0, 0, 0, 0, 0];
      visibles.forEach((r) => {
        const s = semanasSumForRow(r.semanas_por_mes, desdeStr, hastaStr);
        for (let k = 0; k < 5; k++) granSemanas[k] += s[k];
      });
      filas.push({
        tipo: "total_general", representante: "TOTAL GENERAL",
        cuota: granCuota, realizado: granRealizado, semanas: granSemanas,
        diferencia: granRealizado - granCuota, cumplimiento: granCuota ? granRealizado / granCuota : null, sin_cuota: !granCuota,
      });
    }
    return filas;
  }

  function renderRealGeneral(rows, q) {
    q = (q || "").toLowerCase();
    const tbody = document.querySelector("#tabla-real-general tbody");
    tbody.innerHTML = "";
    (rows || []).forEach((r) => {
      if (r.tipo === "espacio") {
        if (!q) tbody.innerHTML += `<tr class="row-espacio"><td colspan="11"></td></tr>`;
        return;
      }
      const hay = ((r.zona || "") + " " + (r.representante || "")).toLowerCase();
      if (q && !hay.includes(q)) return;
      const tr = document.createElement("tr");
      tr.className = "row-" + r.tipo;
      const okCum = r.cumplimiento !== null && r.cumplimiento >= 1;
      const diffCls = r.diferencia === null || r.diferencia === undefined ? "" : (r.diferencia >= 0 ? "pos" : "neg");
      const nameCell = r.tipo === "representante" ? `<td class="indent">${escapeHtml(r.representante || "—")}</td>` : `<td>${escapeHtml(r.representante || "—")}</td>`;
      const cumCell = (r.cumplimiento === null || r.cumplimiento === undefined || r.sin_cuota)
        ? `<span title="Sin cuota en el periodo seleccionado">s/cuota</span>`
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

  function setupScrollTopBtn() {
    const btn = document.getElementById("scrollTopBtn");
    if (!btn) return;
    window.addEventListener("scroll", () => {
      btn.classList.toggle("show", window.scrollY > 400);
    }, { passive: true });
    btn.addEventListener("click", () => {
      const header = document.querySelector(".topbar") || document.body;
      header.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { Object.values(charts).forEach((c) => c.resize()); }, 150);
  });
})();
