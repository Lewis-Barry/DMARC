const copyButton = document.querySelector("#copyButton");
const copyState = document.querySelector("#copyState");
const refreshButton = document.querySelector("#refreshButton");
const rootMode = document.querySelector("#rootMode");
const hostMode = document.querySelector("#hostMode");
const domainTitle = document.querySelector("#domainTitle");
const nameserver = document.querySelector("#nameserver");
const popup = document.querySelector(".popup");
const timestamp = document.querySelector("#timestamp");
const providerNote = document.querySelector("#providerNote");

const spfStatus = document.querySelector("#spfStatus");
const spfRecord = document.querySelector("#spfRecord");
const spfIssues = document.querySelector("#spfIssues");

const dmarcStatus = document.querySelector("#dmarcStatus");
const dmarcRecord = document.querySelector("#dmarcRecord");
const dmarcIssues = document.querySelector("#dmarcIssues");

const dkimStatus = document.querySelector("#dkimStatus");
const selectorForm = document.querySelector("#selectorForm");
const selectorInput = document.querySelector("#selectorInput");
const selectorList = document.querySelector("#selectorList");
const othersChecked = document.querySelector("#othersChecked");
const otherSelectors = document.querySelector("#otherSelectors");
const dkimRecords = document.querySelector("#dkimRecords");

const commonSelectors = [
  "google",
  "selector1",
  "selector2",
  "default",
  "mail",
  "email",
  "dkim",
  "dk",
  "smtp",
  "sendgrid",
  "mailgun",
  "mg",
  "mandrill",
  "mte1",
  "mte2",
  "amazonses",
  "pm",
  "k1",
  "s1",
  "s2",
  "key1",
  "key2",
  "cm",
  "ctct1",
  "ctct2",
  "everlytickey1",
  "everlytickey2",
  "shopifyemail",
  "fm1",
  "fm2",
  "fm3",
  "sig1",
  "litmus1",
  "zoho",
  "protonmail"
];

const secondLevelTlds = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "nhs.uk",
  "org.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "com.mx",
  "com.tr",
  "co.jp",
  "co.za"
]);

const CACHE_TTL_MS = 600 * 1000;
const memoryCache = new Map();

const PROVIDERS = {
  cloudflare: {
    label: "Cloudflare DNS over HTTPS",
    endpoint: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: "application/dns-json" }
  },
  google: {
    label: "Google DNS over HTTPS",
    endpoint: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    headers: { accept: "application/dns-json" }
  }
};

let activeProvider = null;
let currentHostname = "";
let rootDomain = "";
let lookupMode = "root";
let manualSelectors = [];
let latestResults = null;

function extensionStorage() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return null;
  }

  return chrome.storage.local;
}

function getRootDomain(hostname) {
  const cleanHostname = hostname.toLowerCase().replace(/^www\./, "");
  const parts = cleanHostname.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return cleanHostname;
  }

  const finalTwo = parts.slice(-2).join(".");

  if (secondLevelTlds.has(finalTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return finalTwo;
}

function getActiveTabHostname() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      resolve("example.com");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];

      try {
        const tabUrl = new URL(activeTab.url);
        resolve(tabUrl.hostname || "example.com");
      } catch {
        resolve("example.com");
      }
    });
  });
}

function loadManualSelectors() {
  return new Promise((resolve) => {
    const storage = extensionStorage();

    if (!storage) {
      resolve([]);
      return;
    }

    storage.get({ manualSelectors: [] }, (items) => {
      resolve(Array.isArray(items.manualSelectors) ? items.manualSelectors : []);
    });
  });
}

function saveManualSelectors() {
  const storage = extensionStorage();

  if (storage) {
    storage.set({ manualSelectors });
  }
}

function loadProviderPreference() {
  return new Promise((resolve) => {
    const storage = extensionStorage();
    if (!storage) {
      resolve(null);
      return;
    }
    storage.get({ lastProvider: null }, (items) => resolve(items.lastProvider));
  });
}

function saveProviderPreference(name) {
  const storage = extensionStorage();
  if (storage) storage.set({ lastProvider: name });
}

function chooseNextProvider() {
  if (!activeProvider || !PROVIDERS[activeProvider]) {
    activeProvider = Math.random() < 0.5 ? "cloudflare" : "google";
  } else {
    activeProvider = activeProvider === "cloudflare" ? "google" : "cloudflare";
  }
  saveProviderPreference(activeProvider);
  return activeProvider;
}

function readCache(domain) {
  return new Promise((resolve) => {
    const memoryEntry = memoryCache.get(domain);
    if (memoryEntry && Date.now() - memoryEntry.ts < CACHE_TTL_MS) {
      resolve(memoryEntry);
      return;
    }

    const storage = extensionStorage();
    if (!storage) {
      resolve(null);
      return;
    }

    storage.get({ dnsCache: {} }, (items) => {
      const entry = items.dnsCache && items.dnsCache[domain];
      if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
        memoryCache.set(domain, entry);
        resolve(entry);
      } else {
        resolve(null);
      }
    });
  });
}

function writeCache(domain, payload) {
  const entry = { ts: Date.now(), ...payload };
  memoryCache.set(domain, entry);

  const storage = extensionStorage();
  if (!storage) return;

  storage.get({ dnsCache: {} }, (items) => {
    const cache = items.dnsCache || {};
    const now = Date.now();
    Object.keys(cache).forEach((key) => {
      if (now - cache[key].ts >= CACHE_TTL_MS) delete cache[key];
    });
    cache[domain] = entry;
    storage.set({ dnsCache: cache });
  });
}

function clearCacheEntry(domain) {
  memoryCache.delete(domain);

  const storage = extensionStorage();
  if (!storage) return;

  storage.get({ dnsCache: {} }, (items) => {
    const cache = items.dnsCache || {};
    if (cache[domain]) {
      delete cache[domain];
      storage.set({ dnsCache: cache });
    }
  });
}

function normalizeTxtData(data) {
  const quotedChunks = data.match(/"(?:[^"\\]|\\.)*"/g);

  if (!quotedChunks) {
    return data;
  }

  return quotedChunks
    .map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"').replace(/\\;/g, ";"))
    .join("");
}

async function queryDns(provider, name, type) {
  const config = PROVIDERS[provider];
  const response = await fetch(config.endpoint(name, type), { headers: config.headers });

  if (!response.ok) {
    throw new Error(`DNS HTTP ${response.status}`);
  }

  const body = await response.json();
  return Array.isArray(body.Answer) ? body.Answer : [];
}

async function queryTxtRecords(provider, name) {
  const answers = await queryDns(provider, name, "TXT");
  return answers
    .filter((answer) => answer.type === 16 && typeof answer.data === "string")
    .map((answer) => normalizeTxtData(answer.data));
}

async function queryNsRecords(provider, name) {
  const answers = await queryDns(provider, name, "NS");
  return answers
    .filter((answer) => answer.type === 2 && typeof answer.data === "string")
    .map((answer) => answer.data.replace(/\.$/, "").toLowerCase());
}

const SEVERITY_RANK = { ok: 0, warn: 1, error: 2 };

function setStatus(element, label, severity) {
  element.textContent = label;
  element.classList.remove("ok", "warn", "error", "neutral");
  element.classList.add(severity);
}

function setRecordSeverity(element, severity) {
  element.classList.remove("ok", "warn", "error");
  if (severity) element.classList.add(severity);
}

function worstSeverity(issues) {
  return issues.reduce((acc, issue) => SEVERITY_RANK[issue.severity] > SEVERITY_RANK[acc] ? issue.severity : acc, "ok");
}

function renderIssueList(container, issues) {
  container.innerHTML = "";

  issues.forEach((issue) => {
    const li = document.createElement("li");
    li.className = issue.severity;
    const strong = document.createElement("strong");
    strong.textContent = issue.pill;
    li.append(strong);
    li.append(document.createTextNode(issue.helper));
    container.append(li);
  });
}

function pillFor(issues, okLabel) {
  if (!issues.length) return { label: okLabel, severity: "ok" };
  const worst = worstSeverity(issues);
  const headline = issues.find((issue) => issue.severity === worst);
  return { label: headline.pill, severity: worst };
}

function setLoadingState(domain) {
  popup.classList.add("is-loading");
  refreshButton.textContent = "...";
  domainTitle.textContent = domain;
  nameserver.textContent = "Checking nameservers...";
  timestamp.textContent = "Checking...";
  spfRecord.textContent = "Checking SPF TXT records...";
  setRecordSeverity(spfRecord, null);
  spfIssues.innerHTML = "";
  setStatus(spfStatus, "Pending", "neutral");
  dmarcRecord.textContent = "Checking _dmarc TXT records...";
  setRecordSeverity(dmarcRecord, null);
  dmarcIssues.innerHTML = "";
  setStatus(dmarcStatus, "Pending", "neutral");
  dkimRecords.innerHTML = `
    <article>
      <div class="record-minihead">Selectors pending</div>
      <pre class="record-text compact">Checking common DKIM selectors...</pre>
    </article>
  `;
  setStatus(dkimStatus, "Pending", "neutral");
}

function buildSelectorChip(selector, item) {
  const interactive = !!(item && item.found);
  const el = document.createElement(interactive ? "button" : "span");
  el.textContent = selector;

  if (interactive) {
    el.type = "button";
    el.dataset.selector = selector;
    const severity = item.issues.length ? worstSeverity(item.issues) : "ok";
    el.className = `selector ${severity}`;
  } else {
    el.className = "selector static";
  }

  return el;
}

function renderSelectorButtons(perSelector) {
  const selectors = [...new Set([...commonSelectors, ...manualSelectors])];
  selectorList.innerHTML = "";
  otherSelectors.innerHTML = "";

  const entries = selectors.map((selector) => ({
    selector,
    item: perSelector.find((entry) => entry.selector === selector)
  }));
  const foundEntries = entries.filter(({ item }) => item && item.found);
  const otherEntries = entries.filter(({ item }) => !item || !item.found);

  if (!foundEntries.length) {
    entries.forEach(({ selector, item }) => selectorList.append(buildSelectorChip(selector, item)));
    othersChecked.hidden = true;
    return;
  }

  foundEntries.forEach(({ selector, item }) => selectorList.append(buildSelectorChip(selector, item)));
  otherEntries.forEach(({ selector, item }) => otherSelectors.append(buildSelectorChip(selector, item)));
  othersChecked.hidden = otherEntries.length === 0;
}

function isValidSpfMechanism(token) {
  const stripped = token.replace(/^[+\-?~]/, "");
  return /^(all|include:.+|a$|a[:/].+|mx$|mx[:/].+|ip4:.+|ip6:.+|exists:.+|ptr$|ptr:.+|redirect=.+|exp=.+)$/i.test(stripped);
}

function validateSpf(records) {
  if (!records.length) {
    return [{ severity: "error", pill: "Not found", helper: "No SPF record published for this domain." }];
  }
  if (records.length > 1) {
    return [{ severity: "error", pill: "Multiple records", helper: "RFC 7208 requires exactly one SPF record — receivers will reject all of them." }];
  }

  const issues = [];
  const tokens = records[0].trim().split(/\s+/).filter(Boolean);
  const mechanisms = tokens.slice(1);
  const allMech = mechanisms.find((m) => /^[+\-?~]?all$/i.test(m));
  const redirectMech = mechanisms.find((m) => /^redirect=/i.test(m));
  const unknown = mechanisms.find((m) => !isValidSpfMechanism(m));

  if (unknown) {
    issues.push({ severity: "error", pill: "Syntax error", helper: `Unrecognized token: \`${unknown}\`.` });
  }

  if (allMech) {
    const qualifier = /^[+\-?~]/.test(allMech) ? allMech[0] : "+";
    if (qualifier === "+") {
      issues.push({ severity: "error", pill: "Permits all senders", helper: "`+all` lets any server send as this domain — almost always a misconfiguration." });
    } else if (qualifier === "?") {
      issues.push({ severity: "warn", pill: "Neutral policy", helper: "`?all` tells receivers to treat unauthenticated mail as neither pass nor fail." });
    }
  } else if (!redirectMech) {
    issues.push({ severity: "warn", pill: "No fallback", helper: "Record has no terminal `all` mechanism or `redirect=` modifier — behaviour is undefined for non-matching senders." });
  }

  if (mechanisms.some((m) => /^[+\-?~]?ptr(:|$)/i.test(m))) {
    issues.push({ severity: "warn", pill: "Deprecated mechanism", helper: "`ptr` is deprecated (RFC 7208 §5.5) and ignored by many receivers." });
  }

  if (redirectMech && allMech) {
    issues.push({
      severity: "warn",
      pill: "Unreachable redirect",
      helper: "`redirect=` is a modifier that only runs after all mechanisms — but `all` always matches, so the redirect is never evaluated. Remove the `all` (or remove the `redirect=`) for it to take effect."
    });
  }

  const lookupCount = mechanisms.filter((m) => /^[+\-?~]?(include:|a$|a[:/]|mx$|mx[:/]|exists:|ptr$|ptr:)|^redirect=/i.test(m)).length;
  if (lookupCount > 10) {
    issues.push({ severity: "warn", pill: "Too many lookups", helper: `This record uses ${lookupCount} DNS-lookup mechanisms; the RFC limit is 10.` });
  }

  return issues;
}

function parseTagRecord(record) {
  const parts = record.split(";").map((p) => p.trim()).filter(Boolean);
  const tags = new Map();
  const counts = new Map();
  const malformed = [];

  parts.forEach((part) => {
    const eq = part.indexOf("=");
    if (eq === -1) {
      malformed.push(part);
      return;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!tags.has(key)) tags.set(key, value);
  });

  return { tags, counts, malformed };
}

const DMARC_KNOWN_TAGS = ["v", "p", "sp", "adkim", "aspf", "pct", "fo", "rf", "ri", "rua", "ruf"];
const DMARC_TYPOS = { rau: "rua", rauf: "ruf", rufa: "ruf", pcr: "pct", pcrt: "pct", polic: "p", polciy: "p", quar: "p", reject: "p" };

function validateDmarc(records) {
  if (!records.length) {
    return [{ severity: "error", pill: "Not found", helper: "No DMARC record published at `_dmarc.<domain>`." }];
  }
  if (records.length > 1) {
    return [{ severity: "error", pill: "Multiple records", helper: "Only one DMARC record is allowed — receivers will ignore all of them." }];
  }

  const issues = [];
  const { tags, counts, malformed } = parseTagRecord(records[0]);

  if (malformed.length) {
    issues.push({ severity: "error", pill: "Syntax error", helper: `Tag \`${malformed[0]}\` isn't in name=value form.` });
  }

  if (!tags.has("p")) {
    issues.push({ severity: "error", pill: "Missing policy", helper: "Required `p=` tag is absent." });
  } else {
    const pVal = tags.get("p").toLowerCase();
    if (!["none", "quarantine", "reject"].includes(pVal)) {
      issues.push({ severity: "error", pill: "Invalid policy", helper: "`p=` must be `none`, `quarantine`, or `reject`." });
    } else if (pVal === "none") {
      issues.push({ severity: "warn", pill: "No policy", helper: "Policy is monitor-only — failing mail is still delivered." });
    }
  }

  if (tags.has("pct")) {
    const pct = Number(tags.get("pct"));
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      issues.push({ severity: "warn", pill: "Invalid pct", helper: "`pct=` must be an integer between 0 and 100." });
    } else if (pct < 100 && tags.has("p") && ["quarantine", "reject"].includes(tags.get("p").toLowerCase())) {
      issues.push({ severity: "warn", pill: "Partial enforcement", helper: `Only ${pct}% of failing mail is subject to the policy.` });
    }
  }

  const enumTags = { sp: ["none", "quarantine", "reject"], adkim: ["r", "s"], aspf: ["r", "s"] };
  for (const [tag, allowed] of Object.entries(enumTags)) {
    if (tags.has(tag) && !allowed.includes(tags.get(tag).toLowerCase())) {
      issues.push({ severity: "warn", pill: `Invalid ${tag}`, helper: `Allowed values for \`${tag}\`: ${allowed.join(", ")}.` });
    }
  }

  if (tags.has("fo")) {
    const foParts = tags.get("fo").split(":").map((v) => v.trim());
    if (!foParts.every((v) => /^[01ds]$/i.test(v))) {
      issues.push({ severity: "warn", pill: "Invalid fo", helper: "Allowed `fo` values: 0, 1, d, s (colon-separated)." });
    }
  }

  for (const [tag] of counts) {
    if (!DMARC_KNOWN_TAGS.includes(tag)) {
      const suggestion = DMARC_TYPOS[tag];
      issues.push({
        severity: "warn",
        pill: "Unknown tag",
        helper: suggestion ? `Unknown tag \`${tag}\` — did you mean \`${suggestion}\`?` : `Unknown tag \`${tag}\`.`
      });
    }
  }

  for (const [tag, count] of counts) {
    if (count > 1) {
      issues.push({ severity: "warn", pill: "Duplicate tag", helper: `Tag \`${tag}\` appears more than once.` });
    }
  }

  for (const tag of ["rua", "ruf"]) {
    if (tags.has(tag)) {
      const uris = tags.get(tag).split(",").map((u) => u.trim()).filter(Boolean);
      const bad = uris.find((u) => !/^mailto:[^\s@]+@[^\s@]+$/i.test(u));
      if (bad) {
        issues.push({ severity: "warn", pill: "Invalid report URI", helper: `\`${tag}\` values must be \`mailto:\` URIs.` });
      }
    }
  }

  return issues;
}

function estimateRsaKeyBits(base64Key) {
  const cleaned = base64Key.replace(/\s+/g, "");
  const byteLen = Math.floor(cleaned.length * 3 / 4);
  if (byteLen < 150) return 768;
  if (byteLen < 220) return 1024;
  if (byteLen < 360) return 2048;
  if (byteLen < 600) return 3072;
  return 4096;
}

function validateDkimRecord(record) {
  const issues = [];
  const { tags, malformed } = parseTagRecord(record);

  if (malformed.length) {
    issues.push({ severity: "error", pill: "Syntax error", helper: `Tag \`${malformed[0]}\` isn't in name=value form.` });
  }

  if (tags.has("v") && !/^dkim1$/i.test(tags.get("v"))) {
    issues.push({ severity: "warn", pill: "Invalid version", helper: "`v=` must be `DKIM1` when present." });
  }

  if (!tags.has("p")) {
    issues.push({ severity: "error", pill: "Invalid", helper: "Required `p=` tag is absent." });
  } else {
    const p = tags.get("p");
    if (p === "") {
      issues.push({ severity: "warn", pill: "Revoked", helper: "Key revoked — selector no longer signs mail." });
    } else if (!/^[A-Za-z0-9+/=\s]+$/.test(p)) {
      issues.push({ severity: "error", pill: "Invalid key", helper: "Public key isn't valid base64." });
    } else {
      const k = (tags.get("k") || "rsa").toLowerCase();
      if (k === "rsa") {
        const bits = estimateRsaKeyBits(p);
        if (bits < 2048) {
          issues.push({ severity: "warn", pill: "Weak key", helper: `Key is approximately ${bits} bits — use 2048+ for new keys.` });
        }
      }
    }
  }

  if (tags.has("t") && /\by\b/i.test(tags.get("t"))) {
    issues.push({ severity: "warn", pill: "Testing mode", helper: "`t=y` tells receivers to ignore signature failures." });
  }

  if (tags.has("k") && !["rsa", "ed25519"].includes(tags.get("k").toLowerCase())) {
    issues.push({ severity: "warn", pill: "Invalid algorithm", helper: "Only `rsa` and `ed25519` are defined." });
  }

  return issues;
}

function validateDkimSelector(result) {
  if (result.records.length > 1) {
    return [{ severity: "error", pill: "Multiple records", helper: "Selector returned more than one DKIM record." }];
  }
  if (!result.records.length) return [];
  return validateDkimRecord(result.records[0]);
}

function renderSpf(result) {
  if (result.error) {
    spfRecord.textContent = result.error;
    spfIssues.innerHTML = "";
    setStatus(spfStatus, "Lookup failed", "error");
    setRecordSeverity(spfRecord, "error");
    return;
  }

  const issues = validateSpf(result.records);
  spfRecord.textContent = result.records.length ? result.records.join("\n\n") : "No SPF TXT record found";
  renderIssueList(spfIssues, issues);
  const { label, severity } = pillFor(issues, "Found");
  setStatus(spfStatus, label, severity);
  setRecordSeverity(spfRecord, severity);
}

function renderDmarc(result) {
  if (result.error) {
    dmarcRecord.textContent = result.error;
    dmarcIssues.innerHTML = "";
    setStatus(dmarcStatus, "Lookup failed", "error");
    setRecordSeverity(dmarcRecord, "error");
    return;
  }

  const issues = validateDmarc(result.records);
  dmarcRecord.textContent = result.records.length ? result.records.join("\n\n") : "No DMARC TXT record found";
  renderIssueList(dmarcIssues, issues);
  const { label, severity } = pillFor(issues, "Found");
  setStatus(dmarcStatus, label, severity);
  setRecordSeverity(dmarcRecord, severity);
}

function renderDkim(results, domain) {
  const perSelector = results.map((result) => ({
    selector: result.selector,
    found: result.records.length > 0,
    issues: validateDkimSelector(result),
    records: result.records
  }));

  renderSelectorButtons(perSelector);
  dkimRecords.innerHTML = "";

  const found = perSelector.filter((item) => item.found);

  if (!found.length) {
    const article = document.createElement("article");
    const minihead = document.createElement("div");
    minihead.className = "record-minihead";
    minihead.textContent = "No DKIM TXT records found";
    article.append(minihead);
    dkimRecords.append(article);
    setStatus(dkimStatus, "Not found", "error");
    return;
  }

  const allIssues = [];

  found.forEach((item) => {
    const article = document.createElement("article");
    const recordSeverity = item.issues.length ? worstSeverity(item.issues) : "ok";

    const minihead = document.createElement("div");
    minihead.className = "record-minihead";
    minihead.textContent = `${item.selector}._domainkey.${domain}`;
    article.append(minihead);

    item.records.forEach((record) => {
      const recordEl = document.createElement("pre");
      recordEl.className = `record-text compact ${recordSeverity}`;
      recordEl.textContent = record;
      article.append(recordEl);
    });

    if (item.issues.length) {
      const issueList = document.createElement("ul");
      issueList.className = "issue-list";
      renderIssueList(issueList, item.issues);
      article.append(issueList);
    }

    dkimRecords.append(article);
    allIssues.push(...item.issues);
  });

  const severity = allIssues.length ? worstSeverity(allIssues) : "ok";
  setStatus(dkimStatus, `${found.length} found`, severity);
}

function renderNameserver(result) {
  if (result.error) {
    nameserver.textContent = "Nameservers unavailable";
    return;
  }
  if (!result.records.length) {
    nameserver.textContent = "No nameservers found";
    return;
  }
  nameserver.textContent = result.records.join(", ");
}

function applyResults(domain, payload) {
  const providerKey = PROVIDERS[payload.provider] ? payload.provider : "cloudflare";
  latestResults = {
    domain,
    spf: payload.spf,
    dmarc: payload.dmarc,
    dkim: payload.dkim,
    ns: payload.ns,
    provider: providerKey,
    checkedAt: new Date(payload.checkedAt)
  };
  domainTitle.textContent = domain;
  renderNameserver(payload.ns);
  renderSpf(payload.spf);
  renderDmarc(payload.dmarc);
  renderDkim(payload.dkim, domain);
  timestamp.textContent = `Checked ${latestResults.checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  providerNote.textContent = `Records checked through ${PROVIDERS[providerKey].label}`;
  refreshButton.textContent = "R";
  popup.classList.remove("is-loading");
}

async function lookupDomain(domain, { force = false } = {}) {
  if (!force) {
    const cached = await readCache(domain);
    if (cached) {
      applyResults(domain, cached);
      return;
    }
  }

  setLoadingState(domain);
  const provider = chooseNextProvider();

  const selectors = [...new Set([...commonSelectors, ...manualSelectors])];
  const spfPromise = queryTxtRecords(provider, domain)
    .then((records) => ({ name: domain, records: records.filter((record) => /^v=spf1\b/i.test(record)) }))
    .catch((error) => ({ name: domain, records: [], error: error.message }));
  const dmarcName = `_dmarc.${domain}`;
  const dmarcPromise = queryTxtRecords(provider, dmarcName)
    .then((records) => ({ name: dmarcName, records: records.filter((record) => /^v=dmarc1\b/i.test(record)) }))
    .catch((error) => ({ name: dmarcName, records: [], error: error.message }));
  const dkimPromise = Promise.all(selectors.map((selector) => {
    const name = `${selector}._domainkey.${domain}`;

    return queryTxtRecords(provider, name)
      .then((records) => ({ selector, name, records: records.filter((record) => /^v=dkim1\b/i.test(record) || /\bp=/i.test(record)) }))
      .catch((error) => ({ selector, name, records: [], error: error.message }));
  }));
  const nsPromise = queryNsRecords(provider, domain)
    .then((records) => ({ records }))
    .catch((error) => ({ records: [], error: error.message }));

  const [spf, dmarc, dkim, ns] = await Promise.all([spfPromise, dmarcPromise, dkimPromise, nsPromise]);
  const payload = { spf, dmarc, dkim, ns, provider, checkedAt: new Date().toISOString() };
  writeCache(domain, payload);
  applyResults(domain, payload);
}

function activeDomain() {
  return lookupMode === "root" ? rootDomain : currentHostname;
}

function setMode(mode) {
  lookupMode = mode;
  rootMode.classList.toggle("active", mode === "root");
  hostMode.classList.toggle("active", mode === "host");
  lookupDomain(activeDomain());
}

function showCopied() {
  copyState.textContent = "Copied";
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyState.textContent = "";
    copyButton.textContent = "Copy";
  }, 1400);
}

const SEVERITY_DOT = { ok: "🟢", warn: "🟡", error: "🔴" };
const ISSUE_ICON = { warn: "⚠️", error: "❌" };

function formatIssueLines(issues) {
  return issues.map((issue) => `${ISSUE_ICON[issue.severity]} **${issue.pill}** — ${issue.helper}`).join("\n");
}

function sectionHeader(title, pill) {
  return `${SEVERITY_DOT[pill.severity]} **${title}** — ${pill.label}`;
}

function recordLines(records) {
  if (!records.length) return ["_(no record found)_"];
  return records.map((record) => `\`${record}\``);
}

function truncateDkimRecord(record) {
  return record.replace(/(\bp=)([^;\s]{12})[^;]*/, "$1$2...");
}

function sectionBlock(title, pill, records, issues) {
  const lines = [sectionHeader(title, pill), ...recordLines(records)];
  if (issues.length) lines.push(formatIssueLines(issues));
  return lines.join("\n");
}

function copySummary() {
  if (!latestResults) {
    return;
  }

  const lines = [];
  lines.push(`**${latestResults.domain}**`);

  const nsRecords = latestResults.ns && latestResults.ns.records ? latestResults.ns.records : [];
  if (nsRecords.length) {
    lines.push(nsRecords.join(", "));
  }

  const checkedAt = latestResults.checkedAt.toLocaleString();
  const providerLabel = PROVIDERS[latestResults.provider] ? PROVIDERS[latestResults.provider].label : "Cloudflare DNS over HTTPS";
  lines.push(`Checked ${checkedAt} via ${providerLabel}`);
  lines.push("");

  const spfIssueList = validateSpf(latestResults.spf.records);
  lines.push(sectionBlock("SPF", pillFor(spfIssueList, "Found"), latestResults.spf.records, spfIssueList));
  lines.push("");

  const dmarcIssueList = validateDmarc(latestResults.dmarc.records);
  lines.push(sectionBlock("DMARC", pillFor(dmarcIssueList, "Found"), latestResults.dmarc.records, dmarcIssueList));
  lines.push("");

  const dkimFound = latestResults.dkim.filter((result) => result.records.length);
  const dkimNotFound = latestResults.dkim.filter((result) => !result.records.length);

  if (!dkimFound.length) {
    lines.push(sectionHeader("DKIM", { severity: "error", label: "Not found" }));
    lines.push(`_Selectors checked: ${latestResults.dkim.map((r) => r.selector).join(", ")}_`);
  } else {
    const allDkimIssues = [];
    dkimFound.forEach((result) => allDkimIssues.push(...validateDkimSelector(result)));
    const severity = allDkimIssues.length ? worstSeverity(allDkimIssues) : "ok";
    const label = allDkimIssues.length
      ? `${dkimFound.length} found, ${severity === "error" ? "errors" : "warnings"}`
      : `${dkimFound.length} found`;
    lines.push(sectionHeader("DKIM", { severity, label }));

    dkimFound.forEach((result) => {
      const recordIssues = validateDkimSelector(result);
      lines.push("");
      lines.push(`**${result.selector}._domainkey.${latestResults.domain}**`);
      result.records.forEach((record) => lines.push(`\`${truncateDkimRecord(record)}\``));
      if (recordIssues.length) lines.push(formatIssueLines(recordIssues));
    });

    if (dkimNotFound.length) {
      lines.push("");
      lines.push(`_Others checked: ${dkimNotFound.map((r) => r.selector).join(", ")}_`);
    }
  }

  navigator.clipboard.writeText(lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n").then(showCopied, showCopied);
}

function cleanSelector(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
}

copyButton.addEventListener("click", copySummary);
refreshButton.addEventListener("click", () => {
  const domain = activeDomain();
  clearCacheEntry(domain);
  lookupDomain(domain, { force: true });
});
rootMode.addEventListener("click", () => setMode("root"));
hostMode.addEventListener("click", () => setMode("host"));

selectorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selector = cleanSelector(selectorInput.value);

  if (!selector) {
    return;
  }

  const isNew = !commonSelectors.includes(selector) && !manualSelectors.includes(selector);
  if (isNew) {
    manualSelectors.push(selector);
    saveManualSelectors();
  }

  selectorInput.value = "";
  const domain = activeDomain();
  if (isNew) clearCacheEntry(domain);
  lookupDomain(domain, { force: isNew });
});

function handleSelectorClick(event) {
  const selectorButton = event.target.closest(".selector");

  if (!selectorButton || !selectorButton.dataset.selector) {
    return;
  }

  selectorInput.value = selectorButton.dataset.selector;
  selectorInput.focus();
}

selectorList.addEventListener("click", handleSelectorClick);

Promise.all([getActiveTabHostname(), loadManualSelectors(), loadProviderPreference()]).then(([hostname, storedSelectors, storedProvider]) => {
  currentHostname = hostname;
  rootDomain = getRootDomain(hostname);
  manualSelectors = storedSelectors.map(cleanSelector).filter(Boolean);
  activeProvider = storedProvider && PROVIDERS[storedProvider] ? storedProvider : null;
  setMode("root");
});
