const copyButton = document.querySelector("#copyButton");
const copyState = document.querySelector("#copyState");
const refreshButton = document.querySelector("#refreshButton");
const rootMode = document.querySelector("#rootMode");
const hostMode = document.querySelector("#hostMode");
const domainTitle = document.querySelector("#domainTitle");
const statusStrip = document.querySelector("#statusStrip");
const popup = document.querySelector(".popup");
const timestamp = document.querySelector("#timestamp");

const spfStatus = document.querySelector("#spfStatus");
const spfRecord = document.querySelector("#spfRecord");
const spfName = document.querySelector("#spfName");
const spfAll = document.querySelector("#spfAll");
const spfCount = document.querySelector("#spfCount");

const dmarcStatus = document.querySelector("#dmarcStatus");
const dmarcRecord = document.querySelector("#dmarcRecord");
const dmarcPolicy = document.querySelector("#dmarcPolicy");
const dmarcAlignment = document.querySelector("#dmarcAlignment");
const dmarcReports = document.querySelector("#dmarcReports");

const dkimStatus = document.querySelector("#dkimStatus");
const selectorForm = document.querySelector("#selectorForm");
const selectorInput = document.querySelector("#selectorInput");
const selectorList = document.querySelector("#selectorList");
const dkimRecords = document.querySelector("#dkimRecords");

const commonSelectors = [
  "google",
  "selector1",
  "selector2",
  "default",
  "mail",
  "dkim",
  "smtp",
  "sendgrid",
  "mailgun",
  "mandrill",
  "k1",
  "s1",
  "s2",
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

function normalizeTxtData(data) {
  const quotedChunks = data.match(/"(?:[^"\\]|\\.)*"/g);

  if (!quotedChunks) {
    return data;
  }

  return quotedChunks
    .map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"').replace(/\\;/g, ";"))
    .join("");
}

async function queryTxtRecords(name) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetch(url, { headers: { accept: "application/dns-json" } });

  if (!response.ok) {
    throw new Error(`DNS HTTP ${response.status}`);
  }

  const body = await response.json();
  const answers = Array.isArray(body.Answer) ? body.Answer : [];

  return answers
    .filter((answer) => answer.type === 16 && typeof answer.data === "string")
    .map((answer) => normalizeTxtData(answer.data));
}

function splitMechanisms(record) {
  return record.trim().split(/\s+/).filter(Boolean);
}

function parseDmarcTags(record) {
  const tags = new Map();

  record.split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");

    if (rawKey && rawValue.length) {
      tags.set(rawKey.toLowerCase(), rawValue.join("="));
    }
  });

  return tags;
}

function setStatus(element, label, className) {
  element.textContent = label;
  element.classList.remove("found", "missing", "neutral");
  element.classList.add(className);
}

function setLoadingState(domain) {
  popup.classList.add("is-loading");
  refreshButton.textContent = "...";
  domainTitle.textContent = domain;
  statusStrip.textContent = "Checking TXT records through Cloudflare DNS over HTTPS";
  spfName.textContent = domain;
  spfRecord.textContent = "Checking SPF TXT records...";
  spfAll.textContent = "Pending";
  spfCount.textContent = "Pending";
  setStatus(spfStatus, "Pending", "neutral");
  dmarcRecord.textContent = "Checking _dmarc TXT records...";
  dmarcPolicy.textContent = "Pending";
  dmarcAlignment.textContent = "Pending";
  dmarcReports.textContent = "Pending";
  setStatus(dmarcStatus, "Pending", "neutral");
  dkimRecords.innerHTML = `
    <article>
      <div class="record-minihead">Selectors pending</div>
      <pre class="record-text compact">Checking common DKIM selectors...</pre>
    </article>
  `;
  setStatus(dkimStatus, "Pending", "neutral");
}

function renderSelectorButtons(results) {
  const selectors = [...new Set([...commonSelectors, ...manualSelectors])];
  selectorList.innerHTML = "";

  selectors.forEach((selector) => {
    const result = results.find((item) => item.selector === selector);
    const button = document.createElement("button");
    button.className = result && result.records.length ? "selector active" : "selector";
    button.type = "button";
    button.dataset.selector = selector;
    button.textContent = selector;
    selectorList.append(button);
  });
}

function renderSpf(result) {
  spfName.textContent = result.name;
  spfCount.textContent = String(result.records.length);

  if (result.error) {
    spfRecord.textContent = result.error;
    spfAll.textContent = "Lookup failed";
    setStatus(spfStatus, "Lookup failed", "missing");
    return;
  }

  if (!result.records.length) {
    spfRecord.textContent = "No SPF TXT record found";
    spfAll.textContent = "None";
    setStatus(spfStatus, "Not found", "missing");
    return;
  }

  const allMechanisms = result.records
    .flatMap(splitMechanisms)
    .filter((mechanism) => /^[+?~-]all$/i.test(mechanism));

  spfRecord.textContent = result.records.join("\n\n");
  spfAll.textContent = allMechanisms.length ? allMechanisms.join(", ") : "Not present";
  setStatus(spfStatus, result.records.length > 1 ? "Multiple" : "Found", "found");
}

function renderDmarc(result) {
  if (result.error) {
    dmarcRecord.textContent = result.error;
    dmarcPolicy.textContent = "Lookup failed";
    dmarcAlignment.textContent = "Lookup failed";
    dmarcReports.textContent = "Lookup failed";
    setStatus(dmarcStatus, "Lookup failed", "missing");
    return;
  }

  if (!result.records.length) {
    dmarcRecord.textContent = "No DMARC TXT record found";
    dmarcPolicy.textContent = "None";
    dmarcAlignment.textContent = "None";
    dmarcReports.textContent = "None";
    setStatus(dmarcStatus, "Not found", "missing");
    return;
  }

  const tags = parseDmarcTags(result.records[0]);
  const reports = [tags.has("rua") ? "rua present" : "rua absent", tags.has("ruf") ? "ruf present" : "ruf absent"];
  dmarcRecord.textContent = result.records.join("\n\n");
  dmarcPolicy.textContent = tags.has("p") ? `p=${tags.get("p")}` : "p absent";
  dmarcAlignment.textContent = `adkim=${tags.get("adkim") || "absent"}, aspf=${tags.get("aspf") || "absent"}`;
  dmarcReports.textContent = reports.join(", ");
  setStatus(dmarcStatus, result.records.length > 1 ? "Multiple" : "Found", "found");
}

function renderDkim(results, domain) {
  const found = results.filter((result) => result.records.length);
  renderSelectorButtons(results);
  dkimRecords.innerHTML = "";

  if (!found.length) {
    const article = document.createElement("article");
    article.innerHTML = `
      <div class="record-minihead">No DKIM TXT records found</div>
      <pre class="record-text compact">Selectors checked: ${results.map((result) => result.selector).join(", ")}</pre>
    `;
    dkimRecords.append(article);
    setStatus(dkimStatus, "Not found", "missing");
    return;
  }

  found.forEach((result) => {
    result.records.forEach((record) => {
      const article = document.createElement("article");
      article.innerHTML = `
        <div class="record-minihead">${result.selector}._domainkey.${domain}</div>
        <pre class="record-text compact"></pre>
      `;
      article.querySelector("pre").textContent = record;
      dkimRecords.append(article);
    });
  });

  setStatus(dkimStatus, `${found.length} found`, "found");
}

async function lookupDomain(domain) {
  setLoadingState(domain);

  const selectors = [...new Set([...commonSelectors, ...manualSelectors])];
  const spfPromise = queryTxtRecords(domain)
    .then((records) => ({ name: domain, records: records.filter((record) => /^v=spf1\b/i.test(record)) }))
    .catch((error) => ({ name: domain, records: [], error: error.message }));
  const dmarcName = `_dmarc.${domain}`;
  const dmarcPromise = queryTxtRecords(dmarcName)
    .then((records) => ({ name: dmarcName, records: records.filter((record) => /^v=dmarc1\b/i.test(record)) }))
    .catch((error) => ({ name: dmarcName, records: [], error: error.message }));
  const dkimPromise = Promise.all(selectors.map((selector) => {
    const name = `${selector}._domainkey.${domain}`;

    return queryTxtRecords(name)
      .then((records) => ({ selector, name, records: records.filter((record) => /^v=dkim1\b/i.test(record) || /\bp=/i.test(record)) }))
      .catch((error) => ({ selector, name, records: [], error: error.message }));
  }));

  const [spf, dmarc, dkim] = await Promise.all([spfPromise, dmarcPromise, dkimPromise]);
  latestResults = { domain, spf, dmarc, dkim, checkedAt: new Date() };
  renderSpf(spf);
  renderDmarc(dmarc);
  renderDkim(dkim, domain);
  timestamp.textContent = `Checked ${latestResults.checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  statusStrip.textContent = "Records checked through Cloudflare DNS over HTTPS";
  refreshButton.textContent = "R";
  popup.classList.remove("is-loading");
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

function resultBlock(title, status, records) {
  return `${title}\nStatus: ${status}\nRecord:\n${records.length ? records.join("\n\n") : "None"}`;
}

function copySummary() {
  if (!latestResults) {
    return;
  }

  const dkimFound = latestResults.dkim.filter((result) => result.records.length);
  const summary = `Domain: ${latestResults.domain}
Checked: ${latestResults.checkedAt.toLocaleString()}

${resultBlock("SPF", spfStatus.textContent, latestResults.spf.records)}

${resultBlock("DMARC", dmarcStatus.textContent, latestResults.dmarc.records)}

DKIM
Status: ${dkimStatus.textContent}
Selectors checked:
${latestResults.dkim.map((result) => result.selector).join(", ")}

Records found:
${dkimFound.length ? dkimFound.flatMap((result) => result.records.map((record) => `Selector: ${result.selector}\n${record}`)).join("\n\n") : "None"}

DNS provider:
Cloudflare DNS over HTTPS`;

  navigator.clipboard.writeText(summary).then(showCopied, showCopied);
}

function cleanSelector(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
}

copyButton.addEventListener("click", copySummary);
refreshButton.addEventListener("click", () => lookupDomain(activeDomain()));
rootMode.addEventListener("click", () => setMode("root"));
hostMode.addEventListener("click", () => setMode("host"));

selectorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const selector = cleanSelector(selectorInput.value);

  if (!selector) {
    return;
  }

  if (!commonSelectors.includes(selector) && !manualSelectors.includes(selector)) {
    manualSelectors.push(selector);
    saveManualSelectors();
  }

  selectorInput.value = "";
  lookupDomain(activeDomain());
});

selectorList.addEventListener("click", (event) => {
  const selectorButton = event.target.closest(".selector");

  if (!selectorButton) {
    return;
  }

  selectorInput.value = selectorButton.dataset.selector;
  selectorInput.focus();
});

Promise.all([getActiveTabHostname(), loadManualSelectors()]).then(([hostname, storedSelectors]) => {
  currentHostname = hostname;
  rootDomain = getRootDomain(hostname);
  manualSelectors = storedSelectors.map(cleanSelector).filter(Boolean);
  setMode("root");
});
