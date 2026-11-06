"use strict";

// Refuse to run inside a frame (clickjacking protection when the page is hosted somewhere).
if (window.top !== window.self) {
  document.body.textContent = "This page must not be embedded in another site. Open it directly.";
  throw new Error("framed");
}

const { ethers } = window;

// Circle contracts (same address on Ethereum, Arc and Avalanche), see developers.circle.com
const CCTS = "0x431871229103b780868f8C6BB820cd16ECf942BC";               // CrossChainTokenService (non-USDC tokens)
const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"; // CCTP V2 for USDC
const TOKEN_MINTER_V2 = "0xfd78EE919681417d192449715b2594ab58f5D002";
const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
const IRIS = "https://iris-api.circle.com";

const USDC_GAS_RESERVE = 1_000000n;   // on Arc USDC is also the gas token, so 1 USDC always stays behind
const usdcReserve = (r) => (r.src.chainId === 5042 ? USDC_GAS_RESERVE : 0n);
const MAX_USDC_FEE_BPS = 20;           // refuse if Circle ever asks more than 0.2 % for a USDC transfer
// Above these fees (in the source chain's gas token, 18 decimals everywhere) the page asks for confirmation.
const FEE_CONFIRM = { 1: ethers.parseEther("0.003"), 5042: ethers.parseEther("3"), 43114: ethers.parseEther("0.2") };

const CHAINS = {
  1: { name: "Ethereum", hex: "0x1", rpc: "https://ethereum-rpc.publicnode.com", native: "ETH", explorer: "https://etherscan.io/tx/" },
  5042: { name: "Arc", hex: "0x13b2", rpc: "https://rpc.mainnet.arc.io", native: "USDC", explorer: "https://explorer.arc.io/tx/",
          add: { chainId: "0x13b2", chainName: "Arc", rpcUrls: ["https://rpc.mainnet.arc.io"],
                 nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, blockExplorerUrls: ["https://explorer.arc.io"] } },
  43114: { name: "Avalanche", hex: "0xa86a", rpc: "https://api.avax.network/ext/bc/C/rpc", native: "AVAX", explorer: "https://snowtrace.io/tx/",
          add: { chainId: "0xa86a", chainName: "Avalanche C-Chain", rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
                 nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, blockExplorerUrls: ["https://snowtrace.io"] } },
};

const USDC = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  5042: "0x3600000000000000000000000000000000000000",   // ERC-20 interface of native USDC on Arc
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",  // native USDC, not the bridged USDC.e
};
const DOMAIN = { 1: 0, 43114: 1, 5042: 26 };
const usdcRoute = (src, dst, defaultFast) => ({
  kind: "usdc", symbol: "USDC", decimals: 6,
  src: { chainId: src, domain: DOMAIN[src], token: USDC[src] },
  dst: { chainId: dst, domain: DOMAIN[dst], token: USDC[dst] },
  tokenManager: TOKEN_MESSENGER_V2,   // spender for approve
  defaultFast, defaultSelfMint: true,
});

const WETH = { tokenId: "0x5c2cf12eccf48ab63313169ce192dc00af7c37a58bbc546ba4becf54df4962ea", manager: "0x8b86d0a92d779bbcc3208a98df0ab1926b3ac4dd",
               1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 5042: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB" };
const CIRBTC = { tokenId: "0x3d26699fb5d40190fc3fa0dcbc1cd24e558355043c1997572ff9fd6efbb3fdca", manager: "0xa1db0fda2d1bfebe2e5701fe73b252bc2b25700e",
                 1: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E", 5042: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" };
const EURC = { tokenId: "0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c", manager: "0x8c27579e24f9f19d96724e19fc059dacd1469e10",
               1: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 5042: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" };
const cctpxRoute = (t, symbol, decimals, src, dst, defaultFast) => ({
  kind: "cctpx", symbol, decimals, tokenId: t.tokenId, tokenManager: t.manager,
  src: { chainId: src, domain: DOMAIN[src], token: t[src] },
  dst: { chainId: dst, domain: DOMAIN[dst], token: t[dst] },
  defaultFast, defaultSelfMint: true,
});

const ROUTES = {
  usdc_av_arc: usdcRoute(43114, 5042, false),
  usdc_av_eth: usdcRoute(43114, 1, false),
  usdc_eth_arc: usdcRoute(1, 5042, true),
  usdc_eth_av: usdcRoute(1, 43114, true),
  usdc_arc_eth: usdcRoute(5042, 1, false),
  eurc_arc_eth: cctpxRoute(EURC, "EURC", 6, 5042, 1, false),
  cirbtc_eth_arc: cctpxRoute(CIRBTC, "cirBTC", 8, 1, 5042, true),
  cirbtc_arc_eth: cctpxRoute(CIRBTC, "cirBTC", 8, 5042, 1, false),
  weth_eth_arc: { ...cctpxRoute(WETH, "WETH", 18, 1, 5042, true), canWrap: true },
  weth_arc_eth: cctpxRoute(WETH, "WETH", 18, 5042, 1, false),
};

// Tokens and Circle contracts must never be a recipient: tokens sent there are lost.
const NOT_A_RECIPIENT = new Set([CCTS, TOKEN_MESSENGER_V2, TOKEN_MINTER_V2, MESSAGE_TRANSMITTER,
  ...Object.values(USDC), WETH[1], WETH[5042], CIRBTC[1], CIRBTC[5042], EURC[1], EURC[5042],
  WETH.manager, CIRBTC.manager, EURC.manager, ethers.ZeroAddress].map((a) => a.toLowerCase()));

const MESSENGER = [
  "function localMinter() view returns (address)",
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
];
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const SERVICE = [
  "function resolveTokenManager(bytes32) view returns (address)",
  "function resolveTokenAddress(bytes32) view returns (address)",
  "function crossChainTransfer(bytes32 tokenId, uint256 amount, uint32 destinationDomain, bytes destinationAddress, bytes32 destinationCaller, uint32 minFinalityThreshold, (bytes signedQuote, address refundAddress) claim, bool autoExecuteHookData, bytes hookData) payable",
];

let provider, signer, me, quote, quotedFor;
const $ = (id) => document.getElementById(id);
const log = (m) => { $("log").textContent += m + "\n"; };
const route = () => ROUTES[$("route").value];
const fmtAddr = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const errText = (e) => e.shortMessage || e.message || String(e);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------- one action at a time

// Every action runs under a lock: all buttons are disabled until it finishes, so a double click
// cannot send two transactions. Actions only record which buttons should be enabled afterwards.
const BUTTONS = ["connect", "max", "wrap", "quote", "approve", "send", "resume", "abAdd"];
const want = { connect: true, max: true, abAdd: true, wrap: false, quote: false, approve: false, send: false, resume: false };
let busy = false;
function setBtn(id, on) { want[id] = on; if (!busy) $(id).disabled = !on; }
function applyButtons() {
  for (const id of BUTTONS) $(id).disabled = busy || !want[id];
  for (const id of ["route", "rcpt", "amt", "resumeHash"]) $(id).disabled = busy;
  const r = route();
  $("selfMint").disabled = busy || r.kind === "usdc";
  $("fast").disabled = busy || (r.kind === "usdc" && r.src.chainId !== 1);
  for (const b of document.querySelectorAll("#abList button")) b.disabled = busy;
}
async function run(fn) {
  if (busy) return;
  busy = true; applyButtons();
  try { await fn(); } catch (e) { log("ERROR: " + errText(e)); }
  finally { busy = false; applyButtons(); }
}
const onClick = (id, fn) => { $(id).onclick = () => run(fn); };

// ---------------------------------------------------------------- address book

const AB_KEY = "circle-cctp-bridge.addressBook";
// Labels are plain words only, so a label can never imitate an address or "This wallet".
const cleanLabel = (s) => String(s || "").replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
const badLabel = (s) => !s || /0x/i.test(s) || /wallet/i.test(s);

function validEntry(e) {
  try {
    const address = ethers.getAddress(String(e.address));
    const label = cleanLabel(e.label);
    if (badLabel(label) || NOT_A_RECIPIENT.has(address.toLowerCase())) return null;
    return { label, address };
  } catch { return null; }
}
function loadBook() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(AB_KEY) || "[]"); } catch { raw = []; }
  if (!Array.isArray(raw)) return [];
  const ok = raw.map(validEntry).filter(Boolean);
  if (ok.length !== raw.length) log(`Ignored ${raw.length - ok.length} invalid address book entr${raw.length - ok.length === 1 ? "y" : "ies"}.`);
  return ok;
}
function saveBook(b) {
  try { localStorage.setItem(AB_KEY, JSON.stringify(b)); } catch { log("Could not save the address book in this browser."); }
}
let book = loadBook();

function renderBook() {
  $("abList").textContent = "";
  book.forEach((e, i) => {
    const div = document.createElement("div"); div.className = "ab-item";
    const code = document.createElement("code"); code.textContent = `${e.label} — ${e.address}`;
    const del = document.createElement("button"); del.className = "small"; del.textContent = "Remove"; del.disabled = busy;
    del.onclick = () => { if (busy) return; book.splice(i, 1); saveBook(book); renderBook(); renderRecipients(); };
    div.append(code, del); $("abList").append(div);
  });
}

function renderRecipients() {
  const keep = $("rcpt").value;
  $("rcpt").textContent = "";
  const opt = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; $("rcpt").append(o); };
  opt("self", me ? `This wallet — ${me}` : "This wallet (connect first)");
  book.forEach((e) => opt(e.address, `Saved: ${e.label} — ${e.address}`));
  if ([...$("rcpt").options].some((o) => o.value === keep)) $("rcpt").value = keep;
  showRecipientInfo();
}

function showRecipientInfo() {
  $("rcptInfo").textContent = $("rcpt").value === "self"
    ? "Funds arrive at the same address on the destination network."
    : "⚠️ Funds go to a different address than the connected wallet. Check that you control it on the destination network.";
}

$("abAdd").onclick = () => {
  if (busy) return;
  let a;
  try { a = ethers.getAddress($("abAddr").value.trim()); } catch { log("ERROR: not a valid address (check the checksum)."); return; }
  if (NOT_A_RECIPIENT.has(a.toLowerCase())) { log("ERROR: this is a token or Circle contract, not a wallet. Tokens sent there are lost."); return; }
  const label = cleanLabel($("abLabel").value);
  if (badLabel(label)) { log("ERROR: enter a short label with letters or digits only (no addresses, not \"wallet\")."); return; }
  if (book.some((e) => e.address.toLowerCase() === a.toLowerCase())) { log("This address is already in the address book."); return; }
  book.push({ label, address: a }); saveBook(book);
  $("abAddr").value = ""; $("abLabel").value = "";
  renderBook(); renderRecipients();
  log(`Added to the address book: ${label} — ${a}`);
};
$("rcpt").onchange = showRecipientInfo;

function recipient() {
  if (!me) throw new Error("Connect your wallet first.");
  const v = $("rcpt").value;
  if (v === "self") return { address: me, self: true, label: "this wallet" };
  const entry = book.find((e) => e.address === v);
  if (!entry) throw new Error("The recipient must be this wallet or an address from your address book.");
  return { address: ethers.getAddress(entry.address), self: false, label: entry.label };
}

// ---------------------------------------------------------------- route UI

function showRoute() {
  const r = route();
  const usdc = r.kind === "usdc";
  const info = $("routeInfo"); info.textContent = "";
  const line = (...parts) => {
    const div = document.createElement("div");
    for (const p of parts) {
      if (typeof p === "string") div.append(p);
      else { const c = document.createElement("code"); c.textContent = p.code; div.append(c); }
    }
    info.append(div);
  };
  line(`${r.symbol} ${CHAINS[r.src.chainId].name} `, { code: r.src.token }, ` → ${CHAINS[r.dst.chainId].name} `, { code: r.dst.token });
  if (usdc) {
    line("Approve for Circle TokenMessengerV2 ", { code: TOKEN_MESSENGER_V2 }, ", sent with depositForBurn. " +
      `You sign the mint on ${CHAINS[r.dst.chainId].name} yourself` +
      (r.src.chainId === 5042 ? ". 1 USDC always stays on Arc for gas." : ` (needs a little ${CHAINS[r.dst.chainId].native} for gas).`));
  } else {
    line("Approve for Circle TokenManager ", { code: r.tokenManager }, ", sent with CrossChainTokenService ", { code: CCTS },
      `. Any fee is paid in ${CHAINS[r.src.chainId].native} on ${CHAINS[r.src.chainId].name}.`);
  }
  $("fast").checked = r.defaultFast;
  $("selfMint").checked = r.defaultSelfMint;
  $("sym").textContent = r.symbol;
  quote = null; quotedFor = null;
  for (const id of ["wrap", "quote", "approve", "send", "resume"]) setBtn(id, false);
  $("acct").textContent = "";
  $("amt").value = "";
  applyButtons();
}
$("route").onchange = () => { if (!busy) showRoute(); };
renderBook(); renderRecipients(); showRoute();

function amountUnits() {
  return ethers.parseUnits(($("amt").value || "0").trim(), route().decimals);
}

async function ensureChain(chainId) {
  const c = CHAINS[chainId];
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: c.hex }] });
  } catch (e) {
    if (e.code === 4902 && c.add) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [c.add] });
    } else { throw e; }
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chainId) throw new Error(`The wallet is not on ${c.name} (chainId ${net.chainId}).`);
  signer = await provider.getSigner();
  me = await signer.getAddress();
}

async function refreshBalances() {
  const r = route();
  const bal = await new ethers.Contract(r.src.token, ERC20, provider).balanceOf(me);
  const gas = await provider.getBalance(me);
  $("acct").textContent = `Sender: ${me} | ${r.symbol}: ${ethers.formatUnits(bal, r.decimals)} | ${CHAINS[r.src.chainId].native} (gas): ${ethers.formatEther(gas)}`;
  return bal;
}

async function checkArcReserve(r, amount) {
  if (!usdcReserve(r) || r.kind !== "usdc") return;
  const bal = await new ethers.Contract(r.src.token, ERC20, provider).balanceOf(me);
  if (bal < amount) throw new Error("Not enough USDC.");
  if (bal - amount < USDC_GAS_RESERVE / 2n) throw new Error("Keep at least 0.5 USDC on Arc for gas (USDC is the gas token there).");
}

// ---------------------------------------------------------------- actions

onClick("connect", async () => {
  if (!window.ethereum) throw new Error("No wallet found in this browser (Rabby, MetaMask…).");
  const r = route();
  await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureChain(r.src.chainId);
  // verify Circle's contracts on-chain before anything else
  if (r.kind === "usdc") {
    const lm = await new ethers.Contract(TOKEN_MESSENGER_V2, MESSENGER, provider).localMinter();
    if (lm.toLowerCase() !== TOKEN_MINTER_V2.toLowerCase()) throw new Error("TokenMessengerV2 check failed: " + lm);
  } else {
    const svc = new ethers.Contract(CCTS, SERVICE, provider);
    const tm = await svc.resolveTokenManager(r.tokenId);
    const ta = await svc.resolveTokenAddress(r.tokenId);
    if (tm.toLowerCase() !== r.tokenManager.toLowerCase()) throw new Error("TokenManager check failed: " + tm);
    if (ta.toLowerCase() !== r.src.token.toLowerCase()) throw new Error("Token check failed: " + ta);
  }
  renderRecipients();
  const bal = await refreshBalances();
  const reserve = r.kind === "usdc" ? usdcReserve(r) : 0n;
  $("amt").value = ethers.formatUnits(bal > reserve ? bal - reserve : 0n, r.decimals);
  setBtn("quote", true); setBtn("resume", true); setBtn("wrap", !!r.canWrap);
  setBtn("approve", false); setBtn("send", false);
  log(`Connected on ${CHAINS[r.src.chainId].name} as ${me}. Circle contracts verified.`);
});

onClick("max", async () => {
  if (!me || !provider) throw new Error("Click 1. Connect wallet first.");
  const r = route();
  await ensureChain(r.src.chainId);
  const bal = await new ethers.Contract(r.src.token, ERC20, provider).balanceOf(me);
  if (bal === 0n && r.canWrap) {
    // nothing wrapped yet: offer ETH minus a gas reserve
    const reserve = ethers.parseEther("0.012");
    const eth = await provider.getBalance(me);
    const v = eth > reserve ? eth - reserve : 0n;
    $("amt").value = ethers.formatEther(v);
    log(`MAX: ${ethers.formatEther(v)} ETH to wrap (0.012 ETH stays for gas).`);
  } else if (r.kind === "usdc") {
    const reserve = usdcReserve(r);
    const v = bal > reserve ? bal - reserve : 0n;
    $("amt").value = ethers.formatUnits(v, r.decimals);
    log(`MAX: ${ethers.formatUnits(v, r.decimals)} USDC` + (reserve ? " (1 USDC stays on Arc for gas)." : "."));
  } else {
    $("amt").value = ethers.formatUnits(bal, r.decimals);
    log(`MAX: ${ethers.formatUnits(bal, r.decimals)} ${r.symbol}.`);
  }
});

onClick("wrap", async () => {
  const r = route();
  if (!r.canWrap) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  if (amount <= 0n) throw new Error("Enter the amount of ETH to wrap.");
  const eth = await provider.getBalance(me);
  if (eth - amount < ethers.parseEther("0.005")) throw new Error("Keep at least 0.005 ETH for gas.");
  const weth = new ethers.Contract(r.src.token, ["function deposit() payable"], signer);
  const tx = await weth.deposit({ value: amount });
  log("Wrap sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  await tx.wait();
  await refreshBalances();
  log("Wrap confirmed. Continue with 2. Get fee.");
});

onClick("quote", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  const to = recipient();
  const fast = $("fast").checked;
  const selfMint = $("selfMint").checked;
  if (amount <= 0n) throw new Error("Enter an amount.");
  setBtn("approve", false); setBtn("send", false);
  if (r.kind === "usdc") {
    await checkArcReserve(r, amount);
    const bal = await new ethers.Contract(r.src.token, ERC20, provider).balanceOf(me);
    if (bal < amount) throw new Error("Not enough USDC.");
    const fr = await fetch(`${IRIS}/v2/burn/USDC/fees/${r.src.domain}/${r.dst.domain}`);
    if (!fr.ok) throw new Error(await fr.text());
    const tiers = await fr.json();
    const tier = Array.isArray(tiers) && tiers.find((t) => t.finalityThreshold === (fast ? 1000 : 2000));
    if (!tier) throw new Error("Circle returned no fee for this transfer type.");
    const feeBps = Number(tier.minimumFee);           // in basis points, can be fractional
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > MAX_USDC_FEE_BPS)
      throw new Error(`Circle's fee looks wrong (${tier.minimumFee} bps). Refusing to send.`);
    const hundredths = BigInt(Math.ceil(feeBps * 100));
    // fast transfer: 2x headroom so a small fee change does not fall back to standard finality
    const maxFee = ((amount * hundredths + 999999n) / 1000000n) * (fast ? 2n : 1n);
    quote = { usdc: true, maxFee };
    quotedFor = { key: $("route").value, amount, to: to.address, fast, selfMint: true };
    log(`Circle fee: at most ${ethers.formatUnits(maxFee, 6)} USDC (${fast ? "fast" : "standard"}, you sign the mint on ${CHAINS[r.dst.chainId].name}).`);
  } else {
    const bal = await new ethers.Contract(r.src.token, ERC20, provider).balanceOf(me);
    if (bal < amount) throw new Error(`Not enough ${r.symbol}.`);
    quote = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    quotedFor = { key: $("route").value, amount, to: to.address, fast, selfMint };
    log(`Fee: ${ethers.formatEther(quote.feeTotalAmount)} ${CHAINS[r.src.chainId].native} (${fast ? "fast" : "standard"}, ${selfMint ? "you sign the mint" : "Circle mints for you"}). Send fetches a fresh quote right before signing.`);
  }
  log(`Recipient: ${to.address} on ${CHAINS[r.dst.chainId].name}${to.self ? "" : `  ← ${to.label}, a DIFFERENT address than the sender`}`);
  const allowance = await new ethers.Contract(r.src.token, ERC20, provider).allowance(me, r.tokenManager);
  setBtn("approve", allowance < amount);
  setBtn("send", allowance >= amount);
  log(allowance >= amount ? "Allowance is already set, you can send." : "Approve first (exact amount).");
});

onClick("approve", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  if (!quotedFor || quotedFor.amount !== amount || quotedFor.key !== $("route").value) throw new Error("Click 2. Get fee for this amount first.");
  const tx = await new ethers.Contract(r.src.token, ERC20, signer).approve(r.tokenManager, amount);
  log("Approve sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  await tx.wait();
  log("Approve confirmed. Now 4. Send (it fetches a fresh quote if needed).");
  setBtn("approve", false);
  setBtn("send", true);
});

async function fetchCctpxQuote(r, amount, to, fast, selfMint) {
  const requests = selfMint ? [] : [{ type: "FORWARD", params: { msgType: "TransferMessage", destinationAddress: to } }];
  if (fast) requests.push({ type: "PRE_FINALITY" });
  const res = await fetch(`${IRIS}/v2/quote/cctpx/${r.tokenId}/${r.src.domain}/${r.dst.domain}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amount.toString(), feeToken: ethers.ZeroAddress, requests }),
  });
  if (!res.ok) throw new Error(await res.text());
  const q = await res.json();
  let fee;
  try { fee = BigInt(q.feeTotalAmount); } catch { throw new Error("Circle returned a quote without a valid fee."); }
  if (fee < 0n || !q.signedQuote) throw new Error("Circle returned an invalid quote.");
  return q;
}

// Circle returns the quote validity either as a time (TIMESTAMP) or as a block number (BLOCK_NUMBER)
async function quoteValidity(q) {
  const e = q.expiry || {};
  if (e.mode === "BLOCK_NUMBER" && e.expiresAtBlock) {
    const now = await provider.getBlockNumber();
    return { ok: e.expiresAtBlock - now >= 2, text: `valid for ${e.expiresAtBlock - now} more blocks` };
  }
  if (e.expiresAt) {
    const left = Math.round(e.expiresAt - Date.now() / 1000);
    return { ok: left >= 15, text: `valid for ${left} more seconds` };
  }
  return { ok: true, text: "no expiry given" };
}

// Waits for Circle's attestation and signs receiveMessage on the destination network.
// For a resumed transfer it gives up after 2 minutes if Circle does not know the hash.
async function selfMintOnDestination(r, burnHash, resume = false) {
  log("Waiting for Circle's attestation (a standard transfer from Ethereum takes ~15–20 min, from Arc or Avalanche seconds)...");
  const url = `${IRIS}/v2/messages/${r.src.domain}?transactionHash=${burnHash}`;
  const started = Date.now();
  let msg;
  for (let i = 0; i < 480 && !msg; i++) {   // up to 40 min
    let res;
    try { res = await fetch(url); } catch { res = null; }
    if (res && res.status === 404 && resume && Date.now() - started > 120000)
      throw new Error(`Circle does not know this transaction on ${CHAINS[r.src.chainId].name}. Check the hash and that the route above matches the transfer.`);
    if (res && res.ok) {
      const m = (await res.json()).messages?.[0];
      const d = m && m.decodedMessage;
      if (d && Number(d.destinationDomain) !== r.dst.domain)
        throw new Error(`This transfer goes to Circle domain ${d.destinationDomain}, not to ${CHAINS[r.dst.chainId].name}. Pick the matching route.`);
      if (d && Number(d.sourceDomain) !== r.src.domain)
        throw new Error(`This transfer comes from Circle domain ${d.sourceDomain}, not from ${CHAINS[r.src.chainId].name}. Pick the matching route.`);
      if (m && m.status === "complete" && m.message && m.attestation && m.attestation !== "PENDING") msg = m;
    }
    if (!msg) await sleep(5000);
  }
  if (!msg) throw new Error(`No attestation within 40 min. The transfer is not lost: finish it later under "Finish a pending transfer" with hash ${burnHash}`);
  log(`Attestation ready. Switching to ${CHAINS[r.dst.chainId].name}: sign receiveMessage (the mint).`);
  await ensureChain(r.dst.chainId);
  const mt = new ethers.Contract(MESSAGE_TRANSMITTER, ["function receiveMessage(bytes message, bytes attestation) returns (bool)"], signer);
  const rtx = await mt.receiveMessage(msg.message, msg.attestation);
  log("Mint sent: " + CHAINS[r.dst.chainId].explorer + rtx.hash);
  await rtx.wait();
  log("Mint confirmed.");
}

// Extra confirmation before funds leave for an address other than the connected wallet.
async function confirmRecipient(r, to) {
  if (to.self) return;
  let isContract = false;
  try { isContract = (await new ethers.JsonRpcProvider(CHAINS[r.dst.chainId].rpc).getCode(to.address)) !== "0x"; } catch {}
  const msg = `Send to "${to.label}"\n${to.address}\non ${CHAINS[r.dst.chainId].name}?\n\nThis is NOT the connected wallet.` +
    (isContract ? `\n\nThis address is a smart contract on ${CHAINS[r.dst.chainId].name}. Make sure it can hold ${r.symbol}.` : "");
  if (!window.confirm(msg)) throw new Error("Cancelled.");
}

onClick("send", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  const to = recipient();
  const fast = $("fast").checked;
  const selfMint = $("selfMint").checked;
  if (!quote || !quotedFor || quotedFor.key !== $("route").value || quotedFor.amount !== amount || quotedFor.to !== to.address || quotedFor.fast !== fast || quotedFor.selfMint !== selfMint)
    throw new Error("Get the fee for this route, amount, recipient and mode first.");
  await checkArcReserve(r, amount);
  await confirmRecipient(r, to);
  if (r.kind !== "usdc") {
    // a quote is only valid for a few blocks, so fetch a fresh one right before signing
    const fresh = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    const v = await quoteValidity(fresh);
    if (!v.ok) throw new Error("Circle returned an already expired quote, click Send again.");
    const fee = BigInt(fresh.feeTotalAmount);
    const maxFee = BigInt(quote.feeTotalAmount) * 3n / 2n + ethers.parseEther("0.0001");
    if (fee > maxFee) throw new Error(`The fee jumped to ${ethers.formatEther(fee)}. Click 2. Get fee and check it.`);
    if (fee > FEE_CONFIRM[r.src.chainId] &&
        !window.confirm(`Circle's fee for this transfer is ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}. Continue?`))
      throw new Error("Cancelled.");
    quote = fresh;
    log(`Fresh quote: ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}, ${v.text}. Sign within ~2 minutes.`);
  }
  const destToken = new ethers.Contract(r.dst.token, ERC20, new ethers.JsonRpcProvider(CHAINS[r.dst.chainId].rpc));
  const before = await destToken.balanceOf(to.address);
  let tx;
  if (r.kind === "usdc") {
    const messenger = new ethers.Contract(TOKEN_MESSENGER_V2, MESSENGER, signer);
    tx = await messenger.depositForBurn(
      amount, r.dst.domain,
      ethers.zeroPadValue(to.address, 32),   // mintRecipient as bytes32
      r.src.token,
      ethers.ZeroHash,                       // anyone may deliver the message
      quote.maxFee,
      fast ? 1000 : 2000,                    // from Arc and Avalanche finality is near-instant anyway
    );
  } else {
    const svc = new ethers.Contract(CCTS, SERVICE, signer);
    tx = await svc.crossChainTransfer(
      r.tokenId, amount, r.dst.domain,
      ethers.solidityPacked(["address"], [to.address]),   // raw 20 bytes, not 32
      ethers.ZeroHash,                                     // anyone may deliver the message
      fast ? 1000 : 2000,
      { signedQuote: quote.signedQuote, refundAddress: me },
      false, "0x",
      { value: BigInt(quote.feeTotalAmount) },
    );
  }
  quote = null; quotedFor = null;   // a quote is used only once
  setBtn("send", false);
  log("Transfer sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  log(`Keep this hash. If you close the page, finish the transfer later with it: ${tx.hash}`);
  $("resumeHash").value = tx.hash;
  await tx.wait();
  log(`Confirmed on ${CHAINS[r.src.chainId].name}. Waiting for the mint on ${CHAINS[r.dst.chainId].name} for ${fmtAddr(to.address)}...`);
  if (selfMint) await selfMintOnDestination(r, tx.hash);
  for (let i = 0; i < 180; i++) {
    await sleep(10000);
    const now = await destToken.balanceOf(to.address);
    if (now > before) { log(`DONE: ${fmtAddr(to.address)} received ${ethers.formatUnits(now - before, r.decimals)} ${r.symbol} on ${CHAINS[r.dst.chainId].name}.`); return; }
  }
  log(`The mint has not shown up yet (30 min). The transfer is not lost: check the hash ${tx.hash} on the explorer or use "Finish a pending transfer".`);
});

onClick("resume", async () => {
  const r = route();
  const hash = $("resumeHash").value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Paste a transaction hash (0x followed by 64 hex characters).");
  if (!me) throw new Error("Click 1. Connect wallet first.");
  try {
    await selfMintOnDestination(r, hash, true);
  } catch (e) {
    if (/nonce already used/i.test(errText(e))) throw new Error("This transfer has already been minted.");
    throw e;
  }
});
