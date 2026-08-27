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

  function rackFor(part_no) {
    var key = normalizePN(part_no);
    return RACK[key] || null;
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
  var selected = new Set();
  var sortKey = null, sortAsc = true;
  var PAGE_SIZE = 100;
  var currentPage = 1;
  var filtered = RECORDS.slice();

  var isStockMode = false;
  var stockFiltered = STOCK_RECORDS.slice();
  var stockSortKey = "part_no", stockSortAsc = true;
  var stockCurrentPage = 1;

  function clearArrows() {
    document.querySelectorAll('#matchTable thead .arrow').forEach(function (a) { a.textContent = ""; });
  }

  function toggleModeUI() {
    document.getElementById("locationFieldWrap").style.display = isStockMode ? "" : "none";
    document.getElementById("stockOnlyHint").style.display = isStockMode ? "block" : "none";
    document.getElementById("exportExcelBtn").style.display = isStockMode ? "inline-block" : "none";
    document.getElementById("whatsappBtn").style.display = isStockMode ? "none" : "inline-block";
    document.querySelector(".sel-controls").style.display = isStockMode ? "none" : "flex";
    document.getElementById("f-dcode").disabled = isStockMode;
    document.getElementById("f-dname").disabled = isStockMode;
    document.getElementById("f-state").disabled = isStockMode;
    document.getElementById("matchTable").classList.toggle("stock-mode", isStockMode);
    document.getElementById("pdfBtn").textContent = isStockMode ? "\u2193 PDF" : "\u2193 PDF";
  }

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
      if (status && r.status !== status) return false;
      if (part) {
        var npn = normalizePN(r.part_no);
        var ndesc = normalizePN(r.part_desc);
        if (npn.indexOf(part) === -1 && ndesc.indexOf(part) === -1) return false;
      }
      return true;
    });

    if (sortKey) sortFiltered();
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

    if (stockSortKey) sortStockFiltered();
    stockCurrentPage = 1;
    renderStockView();
  }

  function sortStockFiltered() {
    stockFiltered.sort(function (a, b) {
      var av = a[stockSortKey], bv = b[stockSortKey];
      var an = parseFloat(av), bn = parseFloat(bv);
      var bothNum = !isNaN(an) && !isNaN(bn) && av !== "" && bv !== "";
      if (bothNum) return stockSortAsc ? an - bn : bn - an;
      av = (av === null || av === undefined) ? "" : String(av);
      bv = (bv === null || bv === undefined) ? "" : String(bv);
      return stockSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
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
        '<td></td><td></td><td></td><td></td>' +
        '<td class="pn">' + esc(p.part_no) + '</td>' +
        '<td>' + esc(p.part_desc) + '</td>' +
        '<td>' + esc(p.models) + '</td>' +
        '<td></td><td></td><td></td>' +
        '<td class="stock-cell">' + stockCell(p.chk_qty, false, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.knr_qty, true, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.kpba_qty, false, p.part_no) + '</td>' +
        '<td class="stock-cell">' + stockCell(p.tpba_qty, false, p.part_no) + '</td>' +
        '<td class="num">' + esc(p.total_stock) + '</td>' +
        '</tr>'
      );
    }).join("");
  }

  function sortFiltered() {
    filtered.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      var an = parseFloat(av), bn = parseFloat(bv);
      var bothNum = !isNaN(an) && !isNaN(bn) && av !== "" && bv !== "";
      if (bothNum) {
        return sortAsc ? an - bn : bn - an;
      }
      av = (av === null || av === undefined) ? "" : String(av);
      bv = (bv === null || bv === undefined) ? "" : String(bv);
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  document.querySelectorAll('#matchTable thead th[data-key]').forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.key;
      if (isStockMode) {
        stockSortAsc = (stockSortKey === key) ? !stockSortAsc : true;
        stockSortKey = key;
        sortStockFiltered();
        clearArrows();
        th.querySelector(".arrow").textContent = stockSortAsc ? "\u25B2" : "\u25BC";
        stockCurrentPage = 1;
        renderStockView();
      } else {
        sortAsc = (sortKey === key) ? !sortAsc : true;
        sortKey = key;
        sortFiltered();
        clearArrows();
        th.querySelector(".arrow").textContent = sortAsc ? "\u25B2" : "\u25BC";
        currentPage = 1;
        renderMatches();
      }
    });
  });

  function statusBadge(status) {
    var cls = status === "BACKORDER" ? "status-BACKORDER" : "status-UNPROCESS";
    var label = status === "BACKORDER" ? "Backorder" : "Unprocessed";
    return '<span class="status-badge ' + cls + '">' + esc(label) + '</span>';
  }

  function stockCell(qty, isKNR, partNo) {
    var html = '<div>' + (qty === null || qty === undefined ? "" : qty) + '</div>';
    if (isKNR) {
      var loc = rackFor(partNo);
      if (loc) {
        html += '<span class="rack-tag">' + esc(loc) + '</span>';
      }
    }
    return html;
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

    var rowsHtml = pageRows.map(function (r) {
      var dealerLine = esc(r.dealer_name) +
        (r.contact_name ? '<br><span style="color:#888;font-weight:normal;">' + esc(r.contact_name) +
          (r.contact ? " \u00b7 " + esc(r.contact) : "") + '</span>' : "");
      return (
        '<tr data-id="' + r._id + '">' +
        '<td class="num"><input type="checkbox" class="rowSel" data-id="' + r._id + '" ' + (selected.has(r._id) ? "checked" : "") + '></td>' +
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

    tbody.innerHTML = rowsHtml;

    // row click -> modal (ignore clicks on the checkbox itself)
    tbody.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function (e) {
        if (e.target.classList.contains("rowSel")) return;
        openModal(parseInt(tr.dataset.id, 10));
      });
    });
    tbody.querySelectorAll(".rowSel").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var id = parseInt(cb.dataset.id, 10);
        if (cb.checked) selected.add(id); else selected.delete(id);
      });
    });
  }

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

  ["f-state", "f-dcode", "f-dname", "f-part", "f-status", "f-location"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", applyFilters);
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

  document.getElementById("selAllVisible").addEventListener("change", function (e) {
    if (e.target.checked) {
      filtered.forEach(function (r) { selected.add(r._id); });
    } else {
      filtered.forEach(function (r) { selected.delete(r._id); });
    }
    renderMatches();
  });
  document.getElementById("clearSelBtn").addEventListener("click", function () {
    selected.clear();
    document.getElementById("selAllVisible").checked = false;
    renderMatches();
  });

  // ---------- PDF / WhatsApp / Excel (bulk) ----------
  document.getElementById("pdfBtn").addEventListener("click", function () {
    if (isStockMode && window.jspdf) {
      var locVal = document.getElementById("f-location").value;
      var locLabel = locVal ? locVal.replace("_qty", "").toUpperCase() : "All Locations";
      var doc = new window.jspdf.jsPDF({ orientation: "landscape" });
      doc.setFontSize(13);
      doc.text("Our Stock Holdings \u2014 " + locLabel, 14, 12);
      doc.setFontSize(8);
      doc.text("Generated " + (RAW.generated || "") + " \u2022 Stock as of " + (RAW.stock_date || ""), 14, 17);
      var head = [["Part No", "Description", "Model", "CHK", "KNR", "KNR Rack / Box", "KPBA", "TPBA", "Total"]];
      var body = stockFiltered.map(function (p) {
        return [p.part_no, p.part_desc || "", p.models || "", p.chk_qty, p.knr_qty, rackFor(p.part_no) || "", p.kpba_qty, p.tpba_qty, p.total_stock];
      });
      doc.autoTable({ head: head, body: body, startY: 22, styles: { fontSize: 7 }, headStyles: { fillColor: [31, 78, 120] } });
      doc.save("Our_Stock_" + locLabel.replace(/\s+/g, "-") + "_" + Date.now() + ".pdf");
    } else {
      window.print();
    }
  });

  document.getElementById("exportExcelBtn").addEventListener("click", function () {
    if (!window.XLSX) { alert("Excel export library failed to load (check internet connection)."); return; }
    var rows = stockFiltered.map(function (p) {
      return {
        "Part No": p.part_no,
        "Description": p.part_desc,
        "Model": p.models,
        "CHK": p.chk_qty,
        "KNR": p.knr_qty,
        "KNR Rack / Box": rackFor(p.part_no) || "",
        "KPBA": p.kpba_qty,
        "TPBA": p.tpba_qty,
        "Total Stock": p.total_stock
      };
    });
    var ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 36 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Our Stock");
    var locVal = document.getElementById("f-location").value;
    var locLabel = locVal ? locVal.replace("_qty", "").toUpperCase() : "All-Locations";
    XLSX.writeFile(wb, "Our_Stock_" + locLabel + "_" + Date.now() + ".xlsx");
  });

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
    var recs = selected.size > 0
      ? filtered.filter(function (r) { return selected.has(r._id); })
      : filtered;
    if (recs.length === 0) { alert("No records to share."); return; }
    var text = buildWhatsAppText(recs);
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  });

  // ---------- Modal ----------
  var overlay = document.getElementById("modalOverlay");
  function openModal(id) {
    var r = RECORDS[id];
    if (!r) return;
    document.getElementById("modalTitle").textContent = r.part_no + " \u2014 " + (r.part_desc || "");
    document.getElementById("modalSub").textContent = r.models + (r.vehicle_type ? " \u00b7 " + r.vehicle_type : "");

    var loc = rackFor(r.part_no);
    var rows = [
      ["Dealer", r.dealer_name], ["Dealer Code", r.dcode], ["State", r.state], ["City", r.city],
      ["Contact", (r.contact_name || "") + (r.contact ? " (" + r.contact + ")" : "")],
      ["Status", r.status === "BACKORDER" ? "Backorder" : "Unprocessed Order"],
      ["BO Qty", r.bo_qty], ["DLP (\u20b9)", fmtMoney(r.dlp)],
      ["CHK Stock", r.chk_qty], ["KNR Stock", r.knr_qty + (loc ? " \u2014 " + loc : "")],
      ["KPBA Stock", r.kpba_qty], ["TPBA Stock", r.tpba_qty], ["Total Stock", r.total_stock]
    ];
    document.getElementById("modalBody").innerHTML = rows.map(function (kv) {
      return '<div class="modal-row"><span class="k">' + esc(kv[0]) + '</span><span class="v">' + esc(kv[1]) + '</span></div>';
    }).join("");

    document.getElementById("modalWhatsapp").onclick = function () {
      window.open("https://wa.me/?text=" + encodeURIComponent(buildWhatsAppText([r])), "_blank");
    };
    document.getElementById("modalPdf").onclick = function () { window.print(); };

    overlay.classList.add("open");
  }
  document.getElementById("modalClose").addEventListener("click", function () {
    overlay.classList.remove("open");
  });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  // ==========================================================
  // DEALERS TAB
  // ==========================================================
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

    rows.sort(function (a, b) {
      var av = a[dealerSortKey], bv = b[dealerSortKey];
      if (typeof av === "number" || typeof bv === "number") {
        return dealerSortAsc ? av - bv : bv - av;
      }
      av = String(av || ""); bv = String(bv || "");
      return dealerSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

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
      document.querySelectorAll('#dealerTable thead .arrow').forEach(function (a) { a.textContent = ""; });
      th.querySelector(".arrow").textContent = dealerSortAsc ? "\u25B2" : "\u25BC";
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

    rows.sort(function (a, b) {
      var av = a[partSortKey], bv = b[partSortKey];
      if (typeof av === "number" || typeof bv === "number") {
        return partSortAsc ? av - bv : bv - av;
      }
      av = String(av || ""); bv = String(bv || "");
      return partSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

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
      document.querySelectorAll('#partTable thead .arrow').forEach(function (a) { a.textContent = ""; });
      th.querySelector(".arrow").textContent = partSortAsc ? "\u25B2" : "\u25BC";
      renderParts();
    });
  });

  // ---------- initial render ----------
  applyFilters();
})();
