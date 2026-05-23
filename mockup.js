const popup = document.querySelector("#popup");
const extensionButton = document.querySelector("#extensionButton");
const copyButton = document.querySelector("#copyButton");
const copyState = document.querySelector("#copyState");
const refreshButton = document.querySelector("#refreshButton");
const rootMode = document.querySelector("#rootMode");
const hostMode = document.querySelector("#hostMode");
const domainTitle = document.querySelector("#domainTitle");
const timestamp = document.querySelector("#timestamp");
const selectorForm = document.querySelector("#selectorForm");
const selectorInput = document.querySelector("#selectorInput");
const selectorList = document.querySelector("#selectorList");
const dkimRecords = document.querySelector("#dkimRecords");
const dkimStatus = document.querySelector("#dkimStatus");

const fakeRecords = {
  root: {
    domain: "example.com",
    checked: "Checked 2026-04-30 14:22"
  },
  host: {
    domain: "www.example.com",
    checked: "Checked 2026-04-30 14:23"
  }
};

function setMode(mode) {
  const data = fakeRecords[mode];
  domainTitle.textContent = data.domain;
  timestamp.textContent = data.checked;
  rootMode.classList.toggle("active", mode === "root");
  hostMode.classList.toggle("active", mode === "host");
}

function showCopied() {
  copyState.textContent = "Copied";
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyState.textContent = "";
    copyButton.textContent = "Copy";
  }, 1400);
}

function copySummary() {
  const summary = `Domain: ${domainTitle.textContent}
Checked: ${timestamp.textContent.replace("Checked ", "")}

SPF
Status: Found
Record:
v=spf1 include:_spf.example.net include:mail.example.com -all

DMARC
Status: Found
Record:
v=DMARC1; p=reject; rua=mailto:dmarc@example.com; adkim=s; aspf=r; pct=100

DKIM
Selectors checked:
google, selector1, default, mail, sendgrid

Records found:
Selector: google
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...

Selector: selector1
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ...

DNS provider:
Cloudflare DNS over HTTPS`;

  navigator.clipboard.writeText(summary).then(showCopied, showCopied);
}

function refreshRecords() {
  popup.classList.add("is-loading");
  timestamp.textContent = "Checking...";
  refreshButton.textContent = "...";

  window.setTimeout(() => {
    popup.classList.remove("is-loading");
    refreshButton.textContent = "↻";
    timestamp.textContent = "Checked 2026-04-30 14:24";
  }, 650);
}

function addSelector(selector) {
  const cleanSelector = selector.trim().replace(/[^a-z0-9._-]/gi, "").slice(0, 32);

  if (!cleanSelector) {
    return;
  }

  const selectorButton = document.createElement("button");
  selectorButton.className = "selector active";
  selectorButton.type = "button";
  selectorButton.dataset.selector = cleanSelector;
  selectorButton.textContent = cleanSelector;
  selectorList.append(selectorButton);

  const record = document.createElement("article");
  record.innerHTML = `
    <div class="record-minihead">${cleanSelector}._domainkey.${domainTitle.textContent}</div>
    <pre class="record-text compact">No TXT record found in this mock response</pre>
  `;
  dkimRecords.append(record);
  dkimStatus.textContent = "2 found";
  selectorInput.value = "";
}

extensionButton.addEventListener("click", () => {
  popup.hidden = !popup.hidden;
});

copyButton.addEventListener("click", copySummary);
refreshButton.addEventListener("click", refreshRecords);
rootMode.addEventListener("click", () => setMode("root"));
hostMode.addEventListener("click", () => setMode("host"));

selectorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addSelector(selectorInput.value);
});

selectorList.addEventListener("click", (event) => {
  const selectorButton = event.target.closest(".selector");

  if (!selectorButton) {
    return;
  }

  selectorButton.classList.toggle("active");
});