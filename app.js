import {
  CCTS, CHAINS, MESSAGE_TRANSMITTER, ROUTES, TOKEN_MESSENGER_V2, TOKEN_MINTER_V2,
  WRAP_MAX_RESERVE, WRAP_MIN_LEFT, cctpxFeeJumped, feeNeedsConfirm, finality,
  fastAllowed, fastLabel, maxFillNote, maxFillReserve, maxFillSuffix, quoteStillMatches, routeLabel, selfMintLocked, spendError, transferMode, usdcMaxFee, validEntry,
} from "./logic.mjs";

// Refuse to run inside a frame (clickjacking protection when the page is hosted somewhere).
if (window.top !== window.self) {
  document.body.textContent = "This page must not be embedded in another site. Open it directly.";
  throw new Error("framed");
}

const { ethers } = window;
const IRIS = "https://iris-api.circle.com";

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

let provider, signer, me, pending;
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
  $("selfMint").disabled = busy || selfMintLocked(r);
  $("fast").disabled = busy || !fastAllowed(r);
  $("fastLabel").textContent = fastLabel(r);
  for (const b of document.querySelectorAll("#abList button")) b.disabled = busy;
}
async function run(fn) {
  if (busy) return;
  busy = true; applyButtons();
  try { await fn(); } catch (e) { log("ERROR: " + errText(e)); }
  finally { busy = false; applyButtons(); }
}
const onClick = (id, fn) => { $(id).onclick = () => run(fn); };

// Get fee stores this snapshot on `pending`, next to the quote body.
function quoteSelection(r, amount, to) {
  const { fast, selfMint } = transferMode(r, {
    fast: $("fast").checked,
    selfMint: $("selfMint").checked,
  });
  return { key: $("route").value, amount, to: to.address, fast, selfMint };
}

// ---------------------------------------------------------------- address book

const AB_KEY = "circle-cctp-bridge.addressBook";

function loadBook() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(AB_KEY) || "[]"); } catch { raw = []; }
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map((e) => validEntry(e, ethers.getAddress));
  const ok = parsed.filter((e) => e.ok).map((e) => e.entry);
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
  const result = validEntry({ label: $("abLabel").value, address: $("abAddr").value.trim() }, ethers.getAddress);
  if (!result.ok) { log("ERROR: " + result.error); return; }
  const entry = result.entry;
  if (book.some((e) => e.address.toLowerCase() === entry.address.toLowerCase())) { log("This address is already in the address book."); return; }
  book.push(entry); saveBook(book);
  $("abAddr").value = ""; $("abLabel").value = "";
  renderBook(); renderRecipients();
  log(`Added to the address book: ${entry.label} — ${entry.address}`);
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

function fillRoutes() {
  const sel = $("route");
  sel.textContent = "";
  for (const [key, r] of Object.entries(ROUTES)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = routeLabel(r);
    sel.append(o);
  }
}

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
    const gas = maxFillNote(r);
    line("Approve for Circle TokenMessengerV2 ", { code: TOKEN_MESSENGER_V2 }, ", sent with depositForBurn. " +
      `You sign the mint on ${CHAINS[r.dst.chainId].name} yourself` +
      (gas ? `. ${gas}` : ` (needs a little ${CHAINS[r.dst.chainId].native} for gas).`));
  } else {
    line("Approve for Circle TokenManager ", { code: r.tokenManager }, ", sent with CrossChainTokenService ", { code: CCTS },
      `. Any fee is paid in ${CHAINS[r.src.chainId].native} on ${CHAINS[r.src.chainId].name}.`);
  }
  const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
  $("fast").checked = mode.fast;
  $("selfMint").checked = mode.selfMint;
  $("sym").textContent = r.symbol;
  pending = null;
  for (const id of ["wrap", "quote", "approve", "send", "resume"]) setBtn(id, false);
  $("acct").textContent = "";
  $("amt").value = "";
  applyButtons();
}
$("route").onchange = () => { if (!busy) showRoute(); };
fillRoutes(); renderBook(); renderRecipients(); showRoute();

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

async function tokenBalance(token) {
  return new ethers.Contract(token, ERC20, provider).balanceOf(me);
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
  const reserve = maxFillReserve(r);
  $("amt").value = ethers.formatUnits(bal > reserve ? bal - reserve : 0n, r.decimals);
  setBtn("quote", true); setBtn("resume", true); setBtn("wrap", !!r.canWrap);
  setBtn("approve", false); setBtn("send", false);
  log(`Connected on ${CHAINS[r.src.chainId].name} as ${me}. Circle contracts verified.`);
});

onClick("max", async () => {
  if (!me || !provider) throw new Error("Click 1. Connect wallet first.");
  const r = route();
  await ensureChain(r.src.chainId);
  const bal = await tokenBalance(r.src.token);
  if (bal === 0n && r.canWrap) {
    // nothing wrapped yet: offer the native gas token minus a gas reserve
    const native = CHAINS[r.src.chainId].native;
    const eth = await provider.getBalance(me);
    const v = eth > WRAP_MAX_RESERVE ? eth - WRAP_MAX_RESERVE : 0n;
    $("amt").value = ethers.formatEther(v);
    log(`MAX: ${ethers.formatEther(v)} ${native} to wrap (${ethers.formatEther(WRAP_MAX_RESERVE)} ${native} stays for gas).`);
    return;
  }
  const reserve = maxFillReserve(r);
  const v = bal > reserve ? bal - reserve : 0n;
  const shown = ethers.formatUnits(v, r.decimals);
  $("amt").value = shown;
  log(`MAX: ${shown} ${r.symbol}${maxFillSuffix(r)}.`);
});

onClick("wrap", async () => {
  const r = route();
  if (!r.canWrap) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  if (amount <= 0n) throw new Error("Enter the amount of ETH to wrap.");
  const eth = await provider.getBalance(me);
  const native = CHAINS[r.src.chainId].native;
  if (eth - amount < WRAP_MIN_LEFT)
    throw new Error(`Keep at least ${ethers.formatEther(WRAP_MIN_LEFT)} ${native} for gas.`);
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
  const toMode = quoteSelection(r, amount, to);
  const { fast, selfMint } = toMode;
  if (amount <= 0n) throw new Error("Enter an amount.");
  setBtn("approve", false); setBtn("send", false);
  const why = spendError(r, amount, await tokenBalance(r.src.token));
  if (why) throw new Error(why);
  let nextQuote;
  if (r.kind === "usdc") {
    const fr = await fetch(`${IRIS}/v2/burn/USDC/fees/${r.src.domain}/${r.dst.domain}`);
    if (!fr.ok) throw new Error(await fr.text());
    const tiers = await fr.json();
    const tier = Array.isArray(tiers) && tiers.find((t) => t.finalityThreshold === finality(fast));
    if (!tier) throw new Error("Circle returned no fee for this transfer type.");
    const maxFee = usdcMaxFee(amount, tier.minimumFee, fast);
    nextQuote = { maxFee };
    log(`Circle fee: at most ${ethers.formatUnits(maxFee, 6)} USDC (${fast ? "fast" : "standard"}, you sign the mint on ${CHAINS[r.dst.chainId].name}).`);
  } else {
    nextQuote = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    log(`Fee: ${ethers.formatEther(nextQuote.feeTotalAmount)} ${CHAINS[r.src.chainId].native} (${fast ? "fast" : "standard"}, ${selfMint ? "you sign the mint" : "Circle mints for you"}). Send fetches a fresh quote right before signing.`);
  }
  pending = { selection: toMode, body: nextQuote };
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
  const to = recipient();
  const selection = quoteSelection(r, amount, to);
  if (!quoteStillMatches(pending?.selection, selection))
    throw new Error("Click 2. Get fee for this route, amount, recipient and mode first.");
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
  const chainName = CHAINS[r.dst.chainId].name;
  let note = "";
  try {
    const code = await new ethers.JsonRpcProvider(CHAINS[r.dst.chainId].rpc).getCode(to.address);
    if (code !== "0x") note = `\n\nThis address is a smart contract on ${chainName}. Make sure it can hold ${r.symbol}.`;
  } catch {
    note = `\n\nCould not check whether this address is a smart contract on ${chainName}. Confirm you control it before sending.`;
  }
  const msg = `Send to "${to.label}"\n${to.address}\non ${chainName}?\n\nThis is NOT the connected wallet.` + note;
  if (!window.confirm(msg)) throw new Error("Cancelled.");
}

onClick("send", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const amount = amountUnits();
  const to = recipient();
  const selection = quoteSelection(r, amount, to);
  const { fast, selfMint } = selection;
  if (!quoteStillMatches(pending?.selection, selection))
    throw new Error("Get the fee for this route, amount, recipient and mode first.");
  const why = spendError(r, amount, await tokenBalance(r.src.token));
  if (why) throw new Error(why);
  await confirmRecipient(r, to);
  if (r.kind !== "usdc") {
    // a quote is only valid for a few blocks, so fetch a fresh one right before signing
    const fresh = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    const v = await quoteValidity(fresh);
    if (!v.ok) throw new Error("Circle returned an already expired quote, click Send again.");
    const fee = BigInt(fresh.feeTotalAmount);
    if (cctpxFeeJumped(BigInt(pending.body.feeTotalAmount), fee)) throw new Error(`The fee jumped to ${ethers.formatEther(fee)}. Click 2. Get fee and check it.`);
    if (feeNeedsConfirm(r.src.chainId, fee) &&
        !window.confirm(`Circle's fee for this transfer is ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}. Continue?`))
      throw new Error("Cancelled.");
    pending = { selection, body: fresh };
    log(`Fresh quote: ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}, ${v.text}. Sign within ~2 minutes.`);
  }
  const quoted = pending.body;
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
      quoted.maxFee,
      finality(fast),                        // from Arc and Avalanche finality is near-instant anyway
    );
  } else {
    const svc = new ethers.Contract(CCTS, SERVICE, signer);
    tx = await svc.crossChainTransfer(
      r.tokenId, amount, r.dst.domain,
      ethers.solidityPacked(["address"], [to.address]),   // raw 20 bytes, not 32
      ethers.ZeroHash,                                     // anyone may deliver the message
      finality(fast),
      { signedQuote: quoted.signedQuote, refundAddress: me },
      false, "0x",
      { value: BigInt(quoted.feeTotalAmount) },
    );
  }
  pending = null;   // a quote is used only once
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
