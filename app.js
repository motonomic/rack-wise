(function () {
  "use strict";

  // ---------- Guard: data files must be linked alongside this HTML ----------
  if (!window.STOCK_DATA) {
    document.getElementById("loadingMsg").textContent =
      "Could not find data.js. Make sure data.js is in the same folder as this file.";
    return;
  }
  var RACK = window.RACK_LOOKUP || {};

  var RAW = window.STOCK_DATA;
  var COLS = RAW.columns;
  var IDX = {};
  COLS.forEach(function (c, i) { IDX[c] = i; });

  // Convert row arrays -> objects once
  var RECORDS = RAW.rows.map(function (r, i) {
    return {
      _id: i,
      dcode: r[IDX.dcode],
      state: r[IDX.state],
      dealer_name: r[IDX.dealer_name],
      city: r[IDX.city],
      contact_name: r[IDX.contact_name],
      contact: r[IDX.contact],
      part_no: r[IDX.part_no],
      part_desc: r[IDX.part_desc],
      models: r[IDX.models],
      vehicle_type: r[IDX.vehicle_type],
      bo_qty: r[IDX.bo_qty],
      dlp: r[IDX.dlp],
      status: r[IDX.status],
      chk_qty: r[IDX.chk_qty],
      knr_qty: r[IDX.knr_qty],
      kpba_qty: r[IDX.kpba_qty],
      tpba_qty: r[IDX.tpba_qty],
      total_stock: r[IDX.total_stock]
    };
  });

  // De-duplicated "our stock" view — one row per part, independent of any
  // dealer backorder. Location qty fields are a snapshot repeated across
  // every backorder line for that part, so first-seen values are correct.
  var STOCK_RECORDS = (function () {
    var seen = {};
    var out = [];
    RECORDS.forEach(function (r) {
      if (seen[r.part_no]) return;
      seen[r.part_no] = true;
      out.push({
        part_no: r.part_no,
        part_desc: r.part_desc,
        models: r.models,
        dlp: r.dlp,
        chk_qty: r.chk_qty,
        knr_qty: r.knr_qty,
        kpba_qty: r.kpba_qty,
        tpba_qty: r.tpba_qty,
        total_stock: r.total_stock
      });
    });
    return out;
  })();

  function normalizePN(s) {
    if (s === null || s === undefined) return "";
    return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Status labels have varied across uploads (e.g. "UNPROCESS ORDER" vs
  // "Unprocessed Order"). Normalize to two canonical buckets so filtering
  // and badges keep working regardless of exact wording/casing.
  function normalizeStatus(s) {
    var u = String(s || "").toUpperCase();
    return u.indexOf("BACK") !== -1 ? "BACKORDER" : "UNPROCESSED";
  }

  function statusLabel(s) {
    return normalizeStatus(s) === "BACKORDER" ? "Backorder" : "Unprocessed";
  }

  function rackFor(part_no) {
    var key = normalizePN(part_no);
    return RACK[key] || null;
  }

  // Rack/box location is only meaningful where there is stock at KNR.
  function knrRack(qty, part_no) {
    return (parseFloat(qty) > 0) ? (rackFor(part_no) || "") : "";
  }

  // Columns that hold numbers. Everything else sorts as text. (Deciding per column,
  // not per value, avoids parseFloat turning part no. "08310K0ZA00" into 8310.)
  var NUMERIC_KEYS = {
    bo_qty: 1, dlp: 1, chk_qty: 1, knr_qty: 1, kpba_qty: 1, tpba_qty: 1, total_stock: 1,
    lines: 1, qty: 1, value: 1, dealers: 1
  };
  function sortArray(arr, key, asc) {
    var numeric = !!NUMERIC_KEYS[key];
    arr.sort(function (a, b) {
      var av = a[key], bv = b[key], c;
      if (numeric) {
        c = (parseFloat(av) || 0) - (parseFloat(bv) || 0);
      } else {
        av = (av === null || av === undefined) ? "" : String(av).toUpperCase();
        bv = (bv === null || bv === undefined) ? "" : String(bv).toUpperCase();
        c = av < bv ? -1 : (av > bv ? 1 : 0);
      }
      return asc ? c : -c;
    });
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || v === "") return "";
    var n = parseFloat(v);
    if (isNaN(n)) return "";
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Header info ----------
  document.getElementById("branchLine").textContent =
    "Branches: CHK (Chakkarakkal) \u2022 KNR (Kannur) \u2022 KPBA (Kuthuparamba) \u2022 TPBA (Taliparamba) \u2022 Generated " +
    (RAW.generated || "") + " \u2022 BO date " + (RAW.bo_date || "") + " \u2022 Stock as of " + (RAW.stock_date || "");

  // ---------- Tabs ----------
  var tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabButtons.forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "dealers") renderDealers();
      if (btn.dataset.tab === "parts") renderParts();
    });
  });

  // ---------- Populate state dropdowns ----------
  var states = Array.from(new Set(RECORDS.map(function (r) { return r.state; }))).sort();
  function fillStateSelect(sel) {
    states.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    });
  }
  fillStateSelect(document.getElementById("f-state"));
  fillStateSelect(document.getElementById("d-state"));

  // ==========================================================
  // MATCHES TAB
  // ==========================================================
  var selected = new Set();        // Backorder view: selected record _ids
  var selectedStock = new Set();   // Stock-only view: selected part numbers
  var sortKey = null, sortAsc = true;
  var PAGE_SIZE = 100;
  var currentPage = 1;
  var filtered = RECORDS.slice();

  var isStockMode = false;
  var stockFiltered = STOCK_RECORDS.slice();
  var stockSortKey = "part_no", stockSortAsc = true;
  var stockCurrentPage = 1;

  function curSel() { return isStockMode ? selectedStock : selected; }
  function curList() { return isStockMode ? stockFiltered : filtered; }
  function rowKey(rec) { return isStockMode ? rec.part_no : rec._id; }
  function rerender() { if (isStockMode) renderStockView(); else renderMatches(); }

  function clearArrows() {
    document.querySelectorAll('#matchTable thead .arrow').forEach(function (a) { a.textContent = ""; });
  }
  // Show the sort arrow that belongs to the CURRENT view (backorder / stock-only)
  function syncArrows() {
    clearArrows();
    var k = isStockMode ? stockSortKey : sortKey;
    var asc = isStockMode ? stockSortAsc : sortAsc;
    if (!k) return;
    var th = document.querySelector('#matchTable thead th[data-key="' + k + '"]');
    if (th) th.querySelector(".arrow").textContent = asc ? "\u25B2" : "\u25BC";
  }

  function toggleModeUI() {
    document.getElementById("locationFieldWrap").style.display = isStockMode ? "" : "none";
    document.getElementById("stockOnlyHint").style.display = isStockMode ? "block" : "none";
    document.getElementById("whatsappBtn").style.display = isStockMode ? "none" : "inline-block";
    document.getElementById("f-dcode").disabled = isStockMode;
    document.getElementById("f-dname").disabled = isStockMode;
    document.getElementById("f-state").disabled = isStockMode;
    document.getElementById("matchTable").classList.toggle("stock-mode", isStockMode);
    syncArrows();
  }

  // ---------- selection bookkeeping ----------
  // Ticked rows are remembered per view across filter changes / pages, so you can
  // search one part, tick it, search another, tick it, then export them together.
  function updateSelectionUI() {
    var list = curList(), sel = curSel(), inFilter = 0, i;
    for (i = 0; i < list.length; i++) { if (sel.has(rowKey(list[i]))) inFilter++; }
    var allOn = list.length > 0 && inFilter === list.length;
    var some = inFilter > 0 && inFilter < list.length;
    ["selAllVisible", "headerSel"].forEach(function (id) {
      var el = document.getElementById(id);
      el.checked = allOn;
      el.indeterminate = some;
    });
    var n = sel.size;
    document.getElementById("selCount").textContent =
      n > 0 ? n.toLocaleString("en-IN") + " selected" : "none selected";
    updateExportLabels();
  }

  function updateExportLabels() {
    var n = curSel().size, total = curList().length;
    var scope = n > 0 ? n.toLocaleString("en-IN") + " selected" : "all " + total.toLocaleString("en-IN");
    var pdf = document.getElementById("pdfBtn"), xl = document.getElementById("exportExcelBtn");
    if (!pdf.disabled) pdf.textContent = "\u2193 PDF (" + scope + ")";
    if (!xl.disabled) xl.textContent = "\u2193 Excel (" + scope + ")";
  }

  function setAllFiltered(on) {
    var sel = curSel();
    curList().forEach(function (r) { if (on) sel.add(rowKey(r)); else sel.delete(rowKey(r)); });
    rerender();
  }

  // ---------- filtering ----------
  function applyFilters() {
    var statusVal = document.getElementById("f-status").value;
    isStockMode = (statusVal === "__STOCK_ONLY__");
    toggleModeUI();

    if (isStockMode) {
      applyStockFilters();
      return;
    }

    var st = document.getElementById("f-state").value;
    var dcode = document.getElementById("f-dcode").value.trim().toLowerCase();
    var dname = document.getElementById("f-dname").value.trim().toLowerCase();
    var part = normalizePN(document.getElementById("f-part").value);
    var status = statusVal;

    filtered = RECORDS.filter(function (r) {
      if (st && r.state !== st) return false;
      if (dcode && !String(r.dcode || "").toLowerCase().includes(dcode)) return false;
      if (dname && !String(r.dealer_name || "").toLowerCase().includes(dname)) return false;
      if (status && normalizeStatus(r.status) !== status) return false;
      if (part) {
        var npn = normalizePN(r.part_no);
        var ndesc = normalizePN(r.part_desc);
        if (npn.indexOf(part) === -1 && ndesc.indexOf(part) === -1) return false;
      }
      return true;
    });

    if (sortKey) sortArray(filtered, sortKey, sortAsc);
    currentPage = 1;
    renderMatches();
  }

  function applyStockFilters() {
    var part = normalizePN(document.getElementById("f-part").value);
    var loc = document.getElementById("f-location").value;

    stockFiltered = STOCK_RECORDS.filter(function (p) {
      if (part) {
        var npn = normalizePN(p.part_no);
        var ndesc = normalizePN(p.part_desc);
        if (npn.indexOf(part) === -1 && ndesc.indexOf(part) === -1) return false;
      }
      if (loc) {
        var v = parseFloat(p[loc]) || 0;
        if (v <= 0) return false;
      }
      return true;
    });

    if (stockSortKey) sortArray(stockFiltered, stockSortKey, stockSortAsc);
    stockCurrentPage = 1;
    renderStockView();
  }

  // ---------- rendering ----------
  function statusBadge(status) {
    var canon = normalizeStatus(status);
    var cls = canon === "BACKORDER" ? "status-BACKORDER" : "status-UNPROCESS";
    return '<span class="status-badge ' + cls + '">' + esc(statusLabel(status)) + '</span>';
  }

  // KNR cell gets the rack/box tag, but only when there is stock at KNR.
  function stockCell(qty, isKNR, partNo) {
    var html = '<div>' + (qty === null || qty === undefined ? "" : qty) + '</div>';
    if (isKNR) {
      var loc = knrRack(qty, partNo);
      if (loc) {
        html += '<span class="rack-tag">' + esc(loc) + '</span>';
      }
    }
    return html;
  }

  function renderStockView() {
    document.getElementById("loadingMsg").style.display = "none";
    var tbody = document.getElementById("matchBody");
    var noRes = document.getElementById("noResults");

    var total = stockFiltered.length;
    document.getElementById("rowCount").textContent =
      total + " part" + (total === 1 ? "" : "s") + " in our stock" +
      (document.getElementById("f-location").value ? " at " + document.getElementById("f-location").value.replace("_qty", "").toUpperCase() : "");

    if (total === 0) {
      tbody.innerHTML = "";
      noRes.style.display = "block";
      document.getElementById("pagerBar").style.display = "none";
      updateSelectionUI();
      return;
    }
    noRes.style.display = "none";
    document.getElementById("pagerBar").style.display = "flex";

    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (stockCurrentPage > totalPages) stockCurrentPage = totalPages;
    var startIdx = (stockCurrentPage - 1) * PAGE_SIZE;
    var pageRows = stockFiltered.slice(startIdx, startIdx + PAGE_SIZE);

    document.getElementById("pageInfo").textContent =
      "Page " + stockCurrentPage + " of " + totalPages + " (" + total + " total)";

    tbody.innerHTML = pageRows.map(function (p) {
      return (
        '<tr>' +
        '<td class="num"><input type="checkbox" class="rowSel" data-key="' + esc(p.part_no) + '"' + (selectedStock.has(p.part_no) ? " checked" : "") + '></td>' +
        '<td></td><td></td><td></td>' +
        '<td class="pn">' + esc(p.part_no) + '</td>' +
        '<td>' + esc(p.part_desc) + '</td>' +
        '<td>' + esc(p.models) + '</td>' +
        '<td></td>' +
        '<td class="num">' + fmtMoney(p.dlp) + '</td>' +
        '<td></td>' +
        '<td class="stock-cell">' + stockCell(p.chk_qty, false, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.knr_qty, true, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.kpba_qty, false, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.tpba_qty, false, p.part_no) + '</td>' +
        '<td class="num">' + esc(p.total_stock) + '</td>' +
        '</tr>'
      );
    }).join("");
    updateSelectionUI();
  }

  function renderMatches() {
    document.getElementById("loadingMsg").style.display = "none";
    var tbody = document.getElementById("matchBody");
    var noRes = document.getElementById("noResults");

    var total = filtered.length;
    document.getElementById("rowCount").textContent = total + " matching record" + (total === 1 ? "" : "s");

    if (total === 0) {
      tbody.innerHTML = "";
      noRes.style.display = "block";
      document.getElementById("pagerBar").style.display = "none";
      updateSelectionUI();
      return;
    }
    noRes.style.display = "none";
    document.getElementById("pagerBar").style.display = "flex";

    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var startIdx = (currentPage - 1) * PAGE_SIZE;
    var pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    document.getElementById("pageInfo").textContent =
      "Page " + currentPage + " of " + totalPages + " (" + total + " total)";

    tbody.innerHTML = pageRows.map(function (r) {
      var dealerLine = esc(r.dealer_name) +
        (r.contact_name ? '<br><span style="color:#888;font-weight:normal;">' + esc(r.contact_name) +
          (r.contact ? " \u00b7 " + esc(r.contact) : "") + '</span>' : "");
      return (
        '<tr data-id="' + r._id + '">' +
        '<td class="num"><input type="checkbox" class="rowSel" data-id="' + r._id + '"' + (selected.has(r._id) ? " checked" : "") + '></td>' +
        '<td>' + esc(r.state) + '</td>' +
        '<td>' + esc(r.dcode) + '</td>' +
        '<td>' + dealerLine + '</td>' +
        '<td class="pn">' + esc(r.part_no) + '</td>' +
        '<td>' + esc(r.part_desc) + '</td>' +
        '<td>' + esc(r.models) + '</td>' +
        '<td class="num">' + esc(r.bo_qty) + '</td>' +
        '<td class="num">' + fmtMoney(r.dlp) + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td class="stock-cell">' + stockCell(r.chk_qty, false, r.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(r.knr_qty, true, r.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(r.kpba_qty, false, r.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(r.tpba_qty, false, r.part_no) + '</td>' +
        '<td class="num">' + esc(r.total_stock) + '</td>' +
        '</tr>'
      );
    }).join("");
    updateSelectionUI();
  }

  // ---------- table events (delegated: bound once, survive re-renders) ----------
  var matchBody = document.getElementById("matchBody");

  matchBody.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains("rowSel")) return;
    var sel = curSel();
    var key = isStockMode ? t.dataset.key : parseInt(t.dataset.id, 10);
    if (t.checked) sel.add(key); else sel.delete(key);
    updateSelectionUI();
  });

  matchBody.addEventListener("click", function (e) {
    var td = e.target.closest ? e.target.closest("td") : null;
    var tr = e.target.closest ? e.target.closest("tr") : null;
    if (!td || !tr) return;
    var cb = td.querySelector ? td.querySelector("input.rowSel") : null;
    if (cb) {                                   // click anywhere in the checkbox cell toggles the tick
      if (e.target !== cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (isStockMode) return;                    // stock rows have no dealer detail to show
    openModal(parseInt(tr.dataset.id, 10));
  });

  document.querySelectorAll('#matchTable thead th[data-key]').forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.key;
      if (isStockMode) {
        stockSortAsc = (stockSortKey === key) ? !stockSortAsc : true;
        stockSortKey = key;
        sortArray(stockFiltered, stockSortKey, stockSortAsc);
        stockCurrentPage = 1;
      } else {
        sortAsc = (sortKey === key) ? !sortAsc : true;
        sortKey = key;
        sortArray(filtered, sortKey, sortAsc);
        currentPage = 1;
      }
      syncArrows();
      rerender();
    });
  });

  document.getElementById("prevPage").addEventListener("click", function () {
    if (isStockMode) {
      if (stockCurrentPage > 1) { stockCurrentPage--; renderStockView(); }
    } else {
      if (currentPage > 1) { currentPage--; renderMatches(); }
    }
  });
  document.getElementById("nextPage").addEventListener("click", function () {
    if (isStockMode) {
      var totalPagesS = Math.max(1, Math.ceil(stockFiltered.length / PAGE_SIZE));
      if (stockCurrentPage < totalPagesS) { stockCurrentPage++; renderStockView(); }
    } else {
      var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (currentPage < totalPages) { currentPage++; renderMatches(); }
    }
  });

  // text boxes filter as you type; dropdowns filter on change (one event each, no double work)
  ["f-dcode", "f-dname", "f-part"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", applyFilters);
  });
  ["f-state", "f-status", "f-location"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", applyFilters);
  });
  document.getElementById("clearFiltersBtn").addEventListener("click", function () {
    document.getElementById("f-state").value = "";
    document.getElementById("f-dcode").value = "";
    document.getElementById("f-dname").value = "";
    document.getElementById("f-part").value = "";
    document.getElementById("f-status").value = "";
    document.getElementById("f-location").value = "";
    applyFilters();
  });

  document.getElementById("selAllVisible").addEventListener("change", function (e) { setAllFiltered(e.target.checked); });
  document.getElementById("headerSel").addEventListener("change", function (e) { setAllFiltered(e.target.checked); });
  document.getElementById("clearSelBtn").addEventListener("click", function () {
    curSel().clear();
    rerender();
  });

  // ==========================================================
  // EXPORT (PDF / Excel) - honours ticked rows, else all filtered rows
  // ==========================================================
  // Libraries are fetched only when you first click an export button, with fallback mirrors.
  var LIBS = {
    xlsx: [
      "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
    ],
    jspdf: [
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
      "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
    ],
    autotable: [
      "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
      "https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"
    ]
  };
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { s.remove(); reject(new Error("could not load " + url)); };
      document.head.appendChild(s);
    });
  }
  function loadFirst(urls) {
    var i = 0;
    return (function next() {
      if (i >= urls.length) return Promise.reject(new Error("all download sources failed"));
      return loadScript(urls[i++]).catch(next);
    })();
  }
  var libPromises = {};
  function ensureLib(name, isReady) {
    if (isReady()) return Promise.resolve();
    if (!libPromises[name]) {
      libPromises[name] = loadFirst(LIBS[name]).then(function () {
        if (!isReady()) throw new Error(name + " loaded but is not usable");
      }).catch(function (err) { delete libPromises[name]; throw err; });
    }
    return libPromises[name];
  }
  function ensureXLSX() {
    return ensureLib("xlsx", function () { return !!window.XLSX; });
  }
  function ensurePDF() {
    return ensureLib("jspdf", function () { return !!(window.jspdf && window.jspdf.jsPDF); }).then(function () {
      return ensureLib("autotable", function () { return typeof window.jspdf.jsPDF.API.autoTable === "function"; });
    });
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  // What will be exported: every ticked row (in the current sort order) or, if none ticked, all filtered rows.
  function exportScope() {
    var sel = curSel(), recs, tag, label;
    if (sel.size > 0) {
      if (isStockMode) {
        recs = STOCK_RECORDS.filter(function (p) { return sel.has(p.part_no); });
        sortArray(recs, stockSortKey, stockSortAsc);
      } else {
        recs = RECORDS.filter(function (r) { return sel.has(r._id); });
        if (sortKey) sortArray(recs, sortKey, sortAsc);
      }
      tag = "selected-" + recs.length;
      label = recs.length + " selected row(s)";
    } else {
      recs = curList();
      tag = "filtered-" + recs.length;
      label = "all " + recs.length + " row(s) matching the current filters";
    }
    return { records: recs, tag: tag, label: label };
  }

  function selText(id) {
    var el = document.getElementById(id);
    return el.options[el.selectedIndex].text;
  }
  function filterSummary() {
    var out = [], v;
    if (isStockMode) {
      out.push("View: Our Stock Only");
      if (document.getElementById("f-location").value) out.push("Location: " + selText("f-location"));
    } else {
      if (document.getElementById("f-state").value) out.push("State: " + selText("f-state"));
      if ((v = document.getElementById("f-dcode").value.trim())) out.push("Dealer code: " + v);
      if ((v = document.getElementById("f-dname").value.trim())) out.push("Dealer: " + v);
      if (document.getElementById("f-status").value) out.push("Status: " + selText("f-status"));
    }
    if ((v = document.getElementById("f-part").value.trim())) out.push("Part: " + v);
    return out.length ? out.join(" | ") : "none";
  }

  function newPdf(orientation, title, scopeLine) {
    var doc = new window.jspdf.jsPDF({ orientation: orientation, unit: "mm", format: "a4" });
    var w = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(31, 78, 120);
    doc.text(title, 10, 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("Generated " + (RAW.generated || "") + " | BO date " + (RAW.bo_date || "") + " | Stock as of " + (RAW.stock_date || ""), 10, 16);
    var lines = doc.splitTextToSize(scopeLine, w - 20);
    doc.text(lines, 10, 20);
    return { doc: doc, startY: 20 + lines.length * 3.6 + 2 };
  }
  function addPageNumbers(doc) {
    var n = doc.internal.getNumberOfPages();
    var w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text("Page " + i + " of " + n, w - 10, h - 5, { align: "right" });
    }
  }

  function buildBoPdf(scope) {
    var pdf = newPdf("landscape", "BO / PO Stock Match Report",
      "Scope: " + scope.label + "   |   Filters: " + filterSummary());
    var head = [["State", "D.Code", "Dealer", "Contact", "Part No.", "Description", "BO Qty", "DLP (Rs.)", "Status", "CHK", "KNR", "KNR Rack / Box", "KPBA", "TPBA", "Total"]];
    var body = scope.records.map(function (r) {
      return [r.state, r.dcode, r.dealer_name, ((r.contact_name || "") + (r.contact ? " " + r.contact : "")).trim(),
        r.part_no, r.part_desc || "", r.bo_qty, fmtMoney(r.dlp), statusLabel(r.status),
        r.chk_qty, r.knr_qty, knrRack(r.knr_qty, r.part_no), r.kpba_qty, r.tpba_qty, r.total_stock];
    });
    var c = { halign: "center" };
    pdf.doc.autoTable({
      head: head, body: body, startY: pdf.startY,
      margin: { left: 10, right: 10, bottom: 12 },
      styles: { fontSize: 6.5, cellPadding: 1, overflow: "linebreak" },
      headStyles: { fillColor: [31, 78, 120], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      columnStyles: {
        0: { cellWidth: 9 }, 1: { cellWidth: 17 }, 2: { cellWidth: 34 }, 3: { cellWidth: 28 },
        4: { cellWidth: 24 }, 5: { cellWidth: 38 }, 6: Object.assign({ cellWidth: 10 }, c),
        7: { cellWidth: 14, halign: "right" }, 8: { cellWidth: 17 }, 9: Object.assign({ cellWidth: 8 }, c),
        10: Object.assign({ cellWidth: 8 }, c), 11: { cellWidth: 36 }, 12: Object.assign({ cellWidth: 9 }, c),
        13: Object.assign({ cellWidth: 9 }, c), 14: Object.assign({ cellWidth: 10 }, c)
      }
    });
    addPageNumbers(pdf.doc);
    return pdf.doc;
  }

  function buildStockPdf(scope) {
    var pdf = newPdf("landscape", "Our Stock Holdings",
      "Scope: " + scope.label + "   |   Filters: " + filterSummary());
    var head = [["Part No.", "Description", "Model", "DLP (Rs.)", "CHK", "KNR", "KNR Rack / Box", "KPBA", "TPBA", "Total"]];
    var body = scope.records.map(function (p) {
      return [p.part_no, p.part_desc || "", p.models || "", fmtMoney(p.dlp), p.chk_qty, p.knr_qty,
        knrRack(p.knr_qty, p.part_no), p.kpba_qty, p.tpba_qty, p.total_stock];
    });
    var c = { halign: "center" };
    pdf.doc.autoTable({
      head: head, body: body, startY: pdf.startY,
      margin: { left: 10, right: 10, bottom: 12 },
      styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak" },
      headStyles: { fillColor: [31, 78, 120], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      columnStyles: {
        0: { cellWidth: 30 }, 1: { cellWidth: 62 }, 2: { cellWidth: 34 }, 3: { cellWidth: 18, halign: "right" },
        4: Object.assign({ cellWidth: 12 }, c), 5: Object.assign({ cellWidth: 12 }, c), 6: { cellWidth: 58 },
        7: Object.assign({ cellWidth: 12 }, c), 8: Object.assign({ cellWidth: 12 }, c), 9: Object.assign({ cellWidth: 14 }, c)
      }
    });
    addPageNumbers(pdf.doc);
    return pdf.doc;
  }

  function doExportPdf() {
    var scope = exportScope();
    if (scope.records.length === 0) { alert("Nothing to export - no rows match the current filters."); return Promise.resolve(); }
    if (scope.records.length > 4000 &&
        !confirm("This PDF will contain " + scope.records.length.toLocaleString("en-IN") +
          " rows (hundreds of pages) and may take a while.\n\nTip: tick only the rows you need, or narrow the filters.\n\nContinue?")) {
      return Promise.resolve();
    }
    return ensurePDF().then(function () {
      var doc = isStockMode ? buildStockPdf(scope) : buildBoPdf(scope);
      doc.save((isStockMode ? "Our_Stock_" : "BO_Stock_Match_") + scope.tag + "_" + todayStr() + ".pdf");
    });
  }

  function doExportExcel() {
    var scope = exportScope();
    if (scope.records.length === 0) { alert("Nothing to export - no rows match the current filters."); return Promise.resolve(); }
    return ensureXLSX().then(function () {
      var rows, widths, sheetName, prefix;
      if (isStockMode) {
        sheetName = "Our Stock"; prefix = "Our_Stock_";
        rows = scope.records.map(function (p) {
          return {
            "Part No": p.part_no, "Description": p.part_desc, "Model": p.models, "DLP (Rs.)": p.dlp,
            "CHK": p.chk_qty, "KNR": p.knr_qty, "KNR Rack / Box": knrRack(p.knr_qty, p.part_no),
            "KPBA": p.kpba_qty, "TPBA": p.tpba_qty, "Total Stock": p.total_stock
          };
        });
        widths = [16, 30, 16, 11, 8, 8, 36, 8, 8, 10];
      } else {
        sheetName = "BO Stock Match"; prefix = "BO_Stock_Match_";
        rows = scope.records.map(function (r) {
          var bo = parseFloat(r.bo_qty) || 0, dlp = parseFloat(r.dlp) || 0;
          return {
            "State": r.state, "Dealer Code": r.dcode, "Dealer": r.dealer_name,
            "Contact": r.contact_name || "", "Phone": r.contact || "",
            "Part No": r.part_no, "Description": r.part_desc, "Model": r.models,
            "BO Qty": bo, "DLP (Rs.)": dlp, "BO Value (Rs.)": Math.round(bo * dlp * 100) / 100,
            "Status": statusLabel(r.status),
            "CHK": r.chk_qty, "KNR": r.knr_qty, "KNR Rack / Box": knrRack(r.knr_qty, r.part_no),
            "KPBA": r.kpba_qty, "TPBA": r.tpba_qty, "Total Stock": r.total_stock
          };
        });
        widths = [7, 12, 28, 16, 14, 16, 30, 16, 8, 11, 14, 14, 7, 7, 36, 7, 7, 10];
      }
      var ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = widths.map(function (w) { return { wch: w }; });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, prefix + scope.tag + "_" + todayStr() + ".xlsx");
    });
  }

  function runExport(btn, fn) {
    if (btn.disabled) return;
    var oldLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing...";
    new Promise(function (r) { setTimeout(r, 30); })     // let the label repaint before heavy work
      .then(fn)
      .catch(function (err) {
        alert("Export failed: " + (err && err.message ? err.message : err) +
          "\n\nThe PDF/Excel libraries are downloaded when you first export, so an internet connection is needed. Please try again.");
      })
      .then(function () {
        btn.disabled = false;
        if (btn.id === "pdfBtn" || btn.id === "exportExcelBtn") updateExportLabels(); else btn.textContent = oldLabel;
      });
  }
  document.getElementById("pdfBtn").addEventListener("click", function () { runExport(this, doExportPdf); });
  document.getElementById("exportExcelBtn").addEventListener("click", function () { runExport(this, doExportExcel); });

  // ---------- WhatsApp ----------
  function buildWhatsAppText(records) {
    var lines = ["*BO/PO Stock Match*"];
    records.slice(0, 25).forEach(function (r) {
      lines.push(
        "\u2022 " + r.part_no + " (" + r.part_desc + ") - " + r.dealer_name +
        " [" + r.state + "] BO:" + r.bo_qty + " KNR:" + r.knr_qty +
        " TPBA:" + r.tpba_qty + " KPBA:" + r.kpba_qty + " CHK:" + r.chk_qty
      );
    });
    if (records.length > 25) lines.push("...and " + (records.length - 25) + " more");
    return lines.join("\n");
  }

  document.getElementById("whatsappBtn").addEventListener("click", function () {
    var recs = exportScope().records;
    if (recs.length === 0) { alert("No records to share."); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(buildWhatsAppText(recs)), "_blank");
  });

  // ---------- Modal ----------
  var overlay = document.getElementById("modalOverlay");
  function modalRows(r) {
    var loc = knrRack(r.knr_qty, r.part_no);
    return [
      ["Dealer", r.dealer_name], ["Dealer Code", r.dcode], ["State", r.state], ["City", r.city],
      ["Contact", (r.contact_name || "") + (r.contact ? " (" + r.contact + ")" : "")],
      ["Status", statusLabel(r.status) === "Backorder" ? "Backorder" : "Unprocessed Order"],
      ["BO Qty", r.bo_qty], ["DLP (Rs.)", fmtMoney(r.dlp)],
      ["CHK Stock", r.chk_qty], ["KNR Stock", r.knr_qty + (loc ? " - " + loc : "")],
      ["KPBA Stock", r.kpba_qty], ["TPBA Stock", r.tpba_qty], ["Total Stock", r.total_stock]
    ];
  }
  function openModal(id) {
    var r = RECORDS[id];
    if (!r) return;
    document.getElementById("modalTitle").textContent = r.part_no + " \u2014 " + (r.part_desc || "");
    document.getElementById("modalSub").textContent = (r.models || "") + (r.vehicle_type ? " \u00b7 " + r.vehicle_type : "");
    document.getElementById("modalBody").innerHTML = modalRows(r).map(function (kv) {
      return '<div class="modal-row"><span class="k">' + esc(kv[0]) + '</span><span class="v">' + esc(kv[1]) + '</span></div>';
    }).join("");

    document.getElementById("modalWhatsapp").onclick = function () {
      window.open("https://wa.me/?text=" + encodeURIComponent(buildWhatsAppText([r])), "_blank");
    };
    document.getElementById("modalPdf").onclick = function () {
      runExport(document.getElementById("modalPdf"), function () {
        return ensurePDF().then(function () {
          var pdf = newPdf("portrait", "Part Details - " + r.part_no,
            (r.part_desc || "") + (r.models ? " | " + r.models : "") + (r.vehicle_type ? " | " + r.vehicle_type : ""));
          pdf.doc.autoTable({
            head: [["Field", "Value"]], body: modalRows(r).map(function (kv) { return [kv[0], String(kv[1] === null || kv[1] === undefined ? "" : kv[1])]; }),
            startY: pdf.startY, margin: { left: 10, right: 10 },
            styles: { fontSize: 9, cellPadding: 1.8 }, headStyles: { fillColor: [31, 78, 120], textColor: 255 },
            columnStyles: { 0: { cellWidth: 40, fontStyle: "bold" } }
          });
          addPageNumbers(pdf.doc);
          pdf.doc.save("Part_" + String(r.part_no).replace(/[^A-Za-z0-9_-]/g, "") + "_" + String(r.dcode || "").replace(/[^A-Za-z0-9_-]/g, "") + ".pdf");
        });
      });
    };

    overlay.classList.add("open");
  }
  function closeModal() { overlay.classList.remove("open"); }
  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  // ==========================================================
  // DEALERS TAB
  // ==========================================================
  function showArrow(tableSel, key, asc) {
    document.querySelectorAll(tableSel + " thead .arrow").forEach(function (a) { a.textContent = ""; });
    var th = document.querySelector(tableSel + ' thead th[data-key="' + key + '"]');
    if (th) th.querySelector(".arrow").textContent = asc ? "\u25B2" : "\u25BC";
  }

  var dealerSortKey = "value", dealerSortAsc = false;
  var dealersCache = null;

  function buildDealerSummary() {
    var map = {};
    RECORDS.forEach(function (r) {
      var key = r.dealer_name + "||" + r.dcode;
      if (!map[key]) {
        map[key] = { dealer_name: r.dealer_name, dcode: r.dcode, state: r.state, lines: 0, qty: 0, value: 0 };
      }
      map[key].lines += 1;
      map[key].qty += (parseFloat(r.bo_qty) || 0);
      map[key].value += (parseFloat(r.bo_qty) || 0) * (parseFloat(r.dlp) || 0);
    });
    return Object.values(map);
  }

  function renderDealers() {
    if (!dealersCache) dealersCache = buildDealerSummary();
    var st = document.getElementById("d-state").value;
    var q = document.getElementById("d-search").value.trim().toLowerCase();

    var rows = dealersCache.filter(function (d) {
      if (st && d.state !== st) return false;
      if (q && !((d.dealer_name || "").toLowerCase().includes(q) || (d.dcode || "").toLowerCase().includes(q))) return false;
      return true;
    });

    sortArray(rows, dealerSortKey, dealerSortAsc);
    showArrow("#dealerTable", dealerSortKey, dealerSortAsc);

    document.getElementById("dealerRowCount").textContent = rows.length + " dealers";
    var tbody = document.getElementById("dealerBody");
    tbody.innerHTML = rows.map(function (d, i) {
      return "<tr>" +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + esc(d.dealer_name) + '</td>' +
        '<td>' + esc(d.dcode) + '</td>' +
        '<td>' + esc(d.state) + '</td>' +
        '<td class="num">' + d.lines + '</td>' +
        '<td class="num">' + d.qty + '</td>' +
        '<td class="num">' + fmtMoney(d.value) + '</td>' +
        "</tr>";
    }).join("");
  }

  document.getElementById("d-state").addEventListener("change", renderDealers);
  document.getElementById("d-search").addEventListener("input", renderDealers);
  document.querySelectorAll('#dealerTable thead th[data-key]').forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.key;
      if (key === "rank") return;
      dealerSortAsc = (dealerSortKey === key) ? !dealerSortAsc : (key === "dealer_name" || key === "dcode" || key === "state");
      dealerSortKey = key;
      renderDealers();
    });
  });

  // ==========================================================
  // PARTS TAB
  // ==========================================================
  var partsCache = null;
  var partSortKey = "bo_qty", partSortAsc = false;

  function buildPartSummary() {
    var map = {};
    RECORDS.forEach(function (r) {
      var key = r.part_no;
      if (!map[key]) {
        map[key] = {
          part_no: r.part_no, part_desc: r.part_desc, dealers: new Set(),
          bo_qty: 0, chk_qty: r.chk_qty, knr_qty: r.knr_qty, kpba_qty: r.kpba_qty, tpba_qty: r.tpba_qty
        };
      }
      map[key].dealers.add(r.dcode);
      map[key].bo_qty += (parseFloat(r.bo_qty) || 0);
    });
    return Object.values(map).map(function (p) {
      return {
        part_no: p.part_no, part_desc: p.part_desc, dealers: p.dealers.size,
        bo_qty: p.bo_qty, chk_qty: p.chk_qty, knr_qty: p.knr_qty, kpba_qty: p.kpba_qty, tpba_qty: p.tpba_qty
      };
    });
  }

  function renderParts() {
    if (!partsCache) partsCache = buildPartSummary();
    var q = normalizePN(document.getElementById("p-search").value);

    var rows = partsCache.filter(function (p) {
      if (!q) return true;
      return normalizePN(p.part_no).indexOf(q) !== -1 || normalizePN(p.part_desc).indexOf(q) !== -1;
    });

    sortArray(rows, partSortKey, partSortAsc);
    showArrow("#partTable", partSortKey, partSortAsc);

    document.getElementById("partRowCount").textContent = rows.length + " unique parts";
    var tbody = document.getElementById("partBody");
    tbody.innerHTML = rows.map(function (p) {
      var loc = rackFor(p.part_no);
      return "<tr>" +
        '<td class="pn">' + esc(p.part_no) + '</td>' +
        '<td>' + esc(p.part_desc) + '</td>' +
        '<td class="num">' + p.dealers + '</td>' +
        '<td class="num">' + p.bo_qty + '</td>' +
        '<td class="num">' + esc(p.chk_qty) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.knr_qty, true, p.part_no) + '</td>' +
        '<td class="num">' + esc(p.kpba_qty) + '</td>' +
        '<td class="num">' + esc(p.tpba_qty) + '</td>' +
        "</tr>";
    }).join("");
  }

  document.getElementById("p-search").addEventListener("input", renderParts);
  document.querySelectorAll('#partTable thead th[data-key]').forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.key;
      partSortAsc = (partSortKey === key) ? !partSortAsc : false;
      partSortKey = key;
      renderParts();
    });
  });

  // ---------- initial render ----------
  applyFilters();
})();
