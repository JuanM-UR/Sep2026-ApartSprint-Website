"use strict";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  lang: "en",
  data: null,
  locale: null,
  selected: null, // { caseId, instrumentId } — cell detail
};

const SHORT_LABELS = {
  fileable: "Fileable",
  locked: "Locked",
  excluded: "Scope",
  "below-threshold": "Below bar",
  contested: "Contested",
  confidential: "Confidential",
  dismissed: "Non-reportable",
  unknown: "Unknown",
  "no-legal-effect": "No legal effect",
};

const SHORT_LABELS_ES = {
  fileable: "Presentable",
  locked: "Bloqueado",
  excluded: "Alcance",
  "below-threshold": "Bajo umbral",
  contested: "Controvertido",
  confidential: "Confidencial",
  dismissed: "No reportable",
  unknown: "Desconocido",
  "no-legal-effect": "Sin efecto",
};

// Conditions determine the cell outcome; facts are informative only.
// The axis set lives in `data.json` (`axes[].kind`), so a new axis is a content
// edit rather than an engine change.
function axesOfKind(kind) {
  return (state.data.axes || []).filter((a) => a.kind === kind).map((a) => a.id);
}

// Four display categories. `confidential` is a visibility failure, not a lock.
const CATEGORY = {
  fileable: "fileable",
  contested: "contested",
  locked: "locked",
  excluded: "locked",
  "below-threshold": "locked",
  dismissed: "locked",
  confidential: "other",
  unknown: "other",
  "no-legal-effect": "other",
};

const CATEGORIES = ["fileable", "contested", "locked", "other"];

function categoryOf(outcome) {
  return CATEGORY[outcome] || "other";
}

// Per-axis swatch colour: pass is green, not-applicable is neutral.
function gateCategory(status) {
  if (status === "pass") return "fileable";
  if (status === "not-applicable") return "na";
  return categoryOf(status);
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

// A verdict can be absent. An absent verdict is "unknown" — it never passes.
function verdictStatus(axis, value) {
  if (axis === "threshold") {
    if (value === "meets") return "pass";
    if (value === "below") return "below-threshold";
    if (value === "contested") return "contested";
    return "unknown";
  }
  return "unknown";
}

// One row per axis, in fixed order, whether or not the instrument tests it.
function gateStatusFor(instrument, caseRecord, axis) {
  const gate = (instrument.gates || []).find((g) => g.axis === axis);
  if (!gate) return { axis, status: "not-applicable" };

  if (gate.scope === "instrument") {
    return {
      axis,
      status: gate.pass ? "pass" : gate.failure,
      citation: instrument.sourceUrl || null,
      noteKey: gate.noteKey || null,
      noteCitation: gate.noteCitation || null,
    };
  }

  const verdict = (caseRecord.verdicts || {})[instrument.id]?.[axis];
  return {
    axis,
    status: verdictStatus(axis, verdict ? verdict.value : undefined),
    citation: verdict?.citation || null,
    citationPending: verdict?.citationPending || false,
    // A case verdict may override the instrument's default note (a case-specific
    // determination, e.g. an agency ruling on this incident).
    noteKey: verdict?.noteKey || gate.noteKey || null,
    noteCitation: verdict?.noteCitation || gate.noteCitation || null,
  };
}

// The cell colour is the first axis that blocks; details show every axis.
function statusOf(instrument, caseRecord) {
  const gates = axesOfKind("condition").map((axis) => gateStatusFor(instrument, caseRecord, axis));
  const blockers = gates.filter((g) => g.status !== "pass" && g.status !== "not-applicable");

  if (blockers.length) {
    return { outcome: blockers[0].status, primary: blockers[0], gates };
  }
  if (instrument.legalEffect === false) {
    return { outcome: "no-legal-effect", primary: null, gates };
  }
  return { outcome: "fileable", primary: null, gates };
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
function t(key) {
  if (!key) return "";
  return state.locale[key] ?? state.locale["__missing__"] ?? key;
}

function shortOutcome(outcome) {
  const map = state.lang === "es" ? SHORT_LABELS_ES : SHORT_LABELS;
  return map[outcome] || outcome;
}

function gateStatusLabel(status) {
  if (status === "pass") return t("status.pass");
  if (status === "not-applicable") return t("status.not-applicable");
  return t(`outcome.${status}`);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "href") node.setAttribute("href", v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function citationLink(url) {
  return el("a", { href: url, text: url, target: "_blank", rel: "noopener" });
}

// One axis row, shared by the featured card and the cell detail.
function gateRow(gate) {
  const item = el("li");
  item.append(el("div", { class: "gate-line" }, [
    el("span", { class: `swatch cat-${gateCategory(gate.status)}` }),
    el("span", { class: "failure-axis", text: t(`axis.${gate.axis}.label`) }),
    el("span", { text: " — " }),
    el("span", { class: "failure-outcome", text: gateStatusLabel(gate.status) }),
  ]));

  if (gate.noteKey) {
    item.append(el("p", { class: "gate-note", text: t(gate.noteKey) }));
  }

  const blocked = gate.status !== "pass" && gate.status !== "not-applicable";
  const shown = [];
  if (gate.noteCitation) shown.push(gate.noteCitation);
  if (blocked && gate.citation && gate.citation !== gate.noteCitation) shown.push(gate.citation);

  if (shown.length) {
    const line = el("div", { class: "failure-citation" });
    shown.forEach((url, i) => {
      if (i > 0) line.append(document.createTextNode(" · "));
      line.append(citationLink(url));
    });
    item.append(line);
  } else if (blocked) {
    item.append(el("div", { class: "failure-citation" },
      [el("span", { class: "source-pending", text: t("ui.sourcePending") })]));
  }
  return item;
}

// Facts are per-instrument descriptions. They inform; they never gate.
function appendFacts(list, instrument) {
  for (const axis of axesOfKind("fact")) {
    const key = instrument[`${axis}Key`];
    if (!key) continue;
    list.append(el("li", { class: "fact-row" }, [
      el("div", { class: "fact-line" }, [
        el("span", { class: "fact-axis", text: t(`axis.${axis}.label`) }),
        el("span", { text: " \u2014 " }),
        el("span", { class: "fact-value", text: t(key) }),
      ]),
    ]));
  }
}

function caseSources(caseRecord) {
  if (!caseRecord.sources?.length) return null;
  const line = el("p", { class: "failure-citation" });
  line.append(el("strong", { text: `${t("ui.source")}: ` }));
  caseRecord.sources.forEach((url, index) => {
    if (index > 0) line.append(document.createTextNode(" · "));
    line.append(citationLink(url));
  });
  return line;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderHeader() {
  document.documentElement.lang = state.lang;
  document.title = t("site.title");
  document.getElementById("site-title").textContent = t("site.title");
  document.getElementById("site-subtitle").textContent = t("site.subtitle");

  const research = document.getElementById("site-research");
  research.replaceChildren();
  if (state.data.meta.researchUrl) {
    research.append(el("a", { href: state.data.meta.researchUrl, text: t("site.research") }));
  } else {
    research.append(el("span", { class: "source-pending", text: t("site.researchPending") }));
  }

  document.getElementById("site-asof").textContent = `${t("ui.asOf")} ${state.data.meta.asOf}`;
  document.getElementById("lang-toggle").textContent = t("ui.language");
  document.getElementById("footer-note").textContent =
    `${t("ui.asOf")} ${state.data.meta.asOf}`;
}

function renderLegend() {
  document.getElementById("legend-heading").textContent = t("ui.legend");
  document.getElementById("legend-intro").textContent = t("intro.legend");
  const list = document.getElementById("legend");
  list.replaceChildren(...CATEGORIES.map((category) =>
    el("li", {}, [
      el("span", { class: `swatch cat-${category}` }),
      el("span", { text: t(`legend.${category}`) }),
    ])
  ));
}

// One case × one reporting-system card, generated by the same engine as the
// grid. Shared by the featured section and the hypothetical section.
function caseInstrumentCard(caseRecord, instrument, headlineKey) {
  const status = statusOf(instrument, caseRecord);

  const card = el("article", { class: `featured-card cat-${categoryOf(status.outcome)}-edge` });
  card.append(el("h3", { class: "featured-title" },
    [`${t(caseRecord.nameKey)} — ${t(instrument.nameKey)}`]));

  const statusLine = el("div", { class: "status-line" });
  statusLine.append(el("span", { class: `swatch cat-${categoryOf(status.outcome)}` }));
  statusLine.append(el("span", { class: "status-label", text: `${t("ui.status")}:` }));
  statusLine.append(el("span", { text: t(`outcome.${status.outcome}`) }));
  card.append(statusLine);

  card.append(el("p", { class: "featured-headline", text: t(headlineKey) }));

  const list = el("ul", { class: "failure-list" });
  for (const gate of status.gates) list.append(gateRow(gate));
  appendFacts(list, instrument);
  card.append(list);

  const sources = caseSources(caseRecord);
  if (sources) card.append(sources);
  return card;
}

// Static featured card(s): one case × one reporting system, styled as the key
// finding. Curated via `featured` in data.json.
function renderFeatured() {
  const heading = document.getElementById("featured-heading");
  const container = document.getElementById("featured");
  const items = state.data.featured || [];

  document.getElementById("featured-intro").textContent = t("intro.featured");

  if (!items.length) {
    heading.textContent = "";
    container.replaceChildren();
    return;
  }
  heading.textContent = t("ui.keyFinding");

  const cards = items.map((item) => {
    const caseRecord = state.data.cases.find((c) => c.id === item.case);
    const instrument = state.data.instruments.find((i) => i.id === item.instrument);
    return caseInstrumentCard(caseRecord, instrument, item.headlineKey);
  });

  container.replaceChildren(...cards);
}

// Hypothetical section: one synthetic case applied to a curated set of
// instruments, so a reader can see what would and would not work before the
// incident exists. Curated via `hypothetical` in data.json. The synthetic case
// is filtered out of the evidence matrix (renderMatrix).
function renderHypothetical() {
  const heading = document.getElementById("hypothetical-heading");
  const lede = document.getElementById("hypothetical-lede");
  const container = document.getElementById("hypothetical");
  const config = state.data.hypothetical;

  if (!config) {
    heading.textContent = "";
    lede.textContent = "";
    container.replaceChildren();
    return;
  }

  heading.textContent = t("ui.hypothetical");
  lede.textContent = t("intro.hypothetical");

  const caseRecord = state.data.cases.find((c) => c.id === config.case);
  const cards = (config.cards || []).map((item) => {
    const instrument = state.data.instruments.find((i) => i.id === item.instrument);
    return caseInstrumentCard(caseRecord, instrument, item.headlineKey);
  });

  container.replaceChildren(...cards);
}

function renderMatrix() {
  document.getElementById("matrix-heading").textContent = t("ui.matrix");
  const table = document.getElementById("matrix");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  const headerRow = el("tr");
  headerRow.append(el("th", { class: "case-col", text: t("ui.case") }));
  for (const instrument of state.data.instruments) {
    headerRow.append(el("th", { text: t(instrument.nameKey) }));
  }
  thead.replaceChildren(headerRow);

  const rows = state.data.cases.filter((c) => !c.hypothetical).map((caseRecord) => {
    const tr = el("tr");
    tr.append(el("th", { text: t(caseRecord.nameKey) }));

    for (const instrument of state.data.instruments) {
      const status = statusOf(instrument, caseRecord);
      const category = categoryOf(status.outcome);
      const isSelected = state.selected
        && state.selected.caseId === caseRecord.id
        && state.selected.instrumentId === instrument.id;

      const cell = el("td", {
        class: `cell cat-${category}${isSelected ? " selected" : ""}`,
        role: "button",
        tabindex: "0",
        title: t(`outcome.${status.outcome}`),
        "data-outcome": status.outcome,
        text: shortOutcome(status.outcome),
      });
      cell.addEventListener("click", () => {
        state.selected = { caseId: caseRecord.id, instrumentId: instrument.id };
        renderMatrix();
        renderDetail();
      });
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.selected = { caseId: caseRecord.id, instrumentId: instrument.id };
          renderMatrix();
          renderDetail();
        }
      });
      tr.append(cell);
    }
    return tr;
  });
  tbody.replaceChildren(...rows);
}

function renderDetail() {
  const heading = document.getElementById("detail-heading");
  const detail = document.getElementById("detail");
  heading.textContent = t("ui.detail");

  if (!state.selected) {
    detail.replaceChildren(el("p", { class: "hint", text: t("ui.select") }));
    return;
  }

  const caseRecord = state.data.cases.find((c) => c.id === state.selected.caseId);
  const instrument = state.data.instruments.find((i) => i.id === state.selected.instrumentId);
  const status = statusOf(instrument, caseRecord);

  const nodes = [];
  nodes.push(el("h3", { text: t(instrument.nameKey) }));
  nodes.push(el("p", { class: "case-summary", text: t(caseRecord.summaryKey) }));

  if (caseRecord.effects?.length) {
    const chipWrap = el("div", { class: "chips" });
    for (const effect of caseRecord.effects) {
      chipWrap.append(el("span", { class: "chip", text: t(`effect.${effect}`) }));
    }
    nodes.push(el("div", {}, [el("strong", { text: `${t("ui.effects")}:` }), chipWrap]));
  }

  const statusLine = el("div", { class: "status-line" });
  statusLine.append(el("span", { class: `swatch cat-${categoryOf(status.outcome)}` }));
  statusLine.append(el("span", { class: "status-label", text: `${t("ui.status")}:` }));
  statusLine.append(el("span", { text: t(`outcome.${status.outcome}`) }));
  nodes.push(statusLine);

  nodes.push(el("p", { text: `${t("ui.breakdown")}:` }));
  const list = el("ul", { class: "failure-list" });
  for (const gate of status.gates) list.append(gateRow(gate));
  appendFacts(list, instrument);
  nodes.push(list);

  const sources = caseSources(caseRecord);
  if (sources) nodes.push(sources);

  detail.replaceChildren(...nodes);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function loadLexicon(lang) {
  const response = await fetch(`locales/${lang}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load locale: ${lang}`);
  return response.json();
}

async function setLang(lang) {
  state.lang = lang;
  state.locale = await loadLexicon(lang);
  renderHeader();
  renderFeatured();
  renderLegend();
  renderMatrix();
  renderDetail();
  renderHypothetical();
}

async function boot() {
  const dataResponse = await fetch("data.json", { cache: "no-store" });
  state.data = await dataResponse.json();
  await setLang(state.lang);

  document.getElementById("lang-toggle").addEventListener("click", () => {
    setLang(state.lang === "en" ? "es" : "en").catch(console.error);
  });
}

boot().catch((error) => {
  document.body.prepend(el("p", { text: `Error: ${error.message}`, style: "color:#b3261e;padding:1rem" }));
});