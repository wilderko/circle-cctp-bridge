// Route catalog and the safety checks shared by the page and the Bun tests.
// Checksum validation is passed in, so this file does not load ethers.

export const CCTS = "0x431871229103b780868f8C6BB820cd16ECf942BC";
export const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
export const TOKEN_MINTER_V2 = "0xfd78EE919681417d192449715b2594ab58f5D002";
export const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

// Arc USDC is the gas token. MAX and the amount filled in on connect leave ARC_MAX_RESERVE.
// Get fee and Send refuse when less than ARC_SPEND_RESERVE would remain.
export const ARC_MAX_RESERVE = 1_000000n;
export const ARC_SPEND_RESERVE = 500000n;
export const MAX_USDC_FEE_BPS = 20;
const E18 = 10n ** 18n;
// 0.0001 of an 18-decimal gas token, the slack on a CCTPx fee jump.
export const FEE_JUMP_SLACK = E18 / 10_000n;
// ETH left aside when MAX fills a wrap, and the minimum that must remain after it.
export const WRAP_MAX_RESERVE = (12n * E18) / 1000n; // 0.012 ETH
export const WRAP_MIN_LEFT = (5n * E18) / 1000n; // 0.005 ETH
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;
export const finality = (fast) => (fast ? FINALITY_FAST : FINALITY_STANDARD);

export const CHAINS = {
  1: {
    name: "Ethereum",
    domain: 0,
    hex: "0x1",
    rpc: "https://ethereum-rpc.publicnode.com",
    native: "ETH",
    explorer: "https://etherscan.io/tx/",
    feeConfirm: (3n * E18) / 1_000n, // 0.003 ETH
  },
  5042: {
    name: "Arc",
    domain: 26,
    hex: "0x13b2",
    rpc: "https://rpc.mainnet.arc.io",
    native: "USDC",
    explorer: "https://explorer.arc.io/tx/",
    feeConfirm: 3n * E18, // 3 USDC
    add: {
      chainId: "0x13b2",
      chainName: "Arc",
      rpcUrls: ["https://rpc.mainnet.arc.io"],
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      blockExplorerUrls: ["https://explorer.arc.io"],
    },
  },
  43114: {
    name: "Avalanche",
    domain: 1,
    hex: "0xa86a",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    native: "AVAX",
    explorer: "https://snowtrace.io/tx/",
    feeConfirm: E18 / 5n, // 0.2 AVAX
    add: {
      chainId: "0xa86a",
      chainName: "Avalanche C-Chain",
      rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      blockExplorerUrls: ["https://snowtrace.io"],
    },
  },
};

// One record owns the name, the Circle domain, and the fee-confirmation threshold.
// Route builders call this, so a missing or incomplete chain fails while ROUTES is built.
function chain(id) {
  const c = CHAINS[id];
  if (!c || c.domain === undefined || c.feeConfirm === undefined)
    throw new Error(`Unknown chain ${id}.`);
  return c;
}

export const USDC = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  5042: "0x3600000000000000000000000000000000000000",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

export const usdcRoute = (src, dst, defaultFast) => ({
  kind: "usdc",
  symbol: "USDC",
  decimals: 6,
  src: { chainId: src, domain: chain(src).domain, token: USDC[src] },
  dst: { chainId: dst, domain: chain(dst).domain, token: USDC[dst] },
  tokenManager: TOKEN_MESSENGER_V2,
  defaultFast,
  defaultSelfMint: true,
});

export const WETH = {
  tokenId: "0x5c2cf12eccf48ab63313169ce192dc00af7c37a58bbc546ba4becf54df4962ea",
  manager: "0x8b86d0a92d779bbcc3208a98df0ab1926b3ac4dd",
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  5042: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
};
export const CIRBTC = {
  tokenId: "0x3d26699fb5d40190fc3fa0dcbc1cd24e558355043c1997572ff9fd6efbb3fdca",
  manager: "0xa1db0fda2d1bfebe2e5701fe73b252bc2b25700e",
  1: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E",
  5042: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
};
export const EURC = {
  tokenId: "0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c",
  manager: "0x8c27579e24f9f19d96724e19fc059dacd1469e10",
  1: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  5042: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
};

export const cctpxRoute = (t, symbol, decimals, src, dst, defaultFast) => ({
  kind: "cctpx",
  symbol,
  decimals,
  tokenId: t.tokenId,
  tokenManager: t.manager,
  src: { chainId: src, domain: chain(src).domain, token: t[src] },
  dst: { chainId: dst, domain: chain(dst).domain, token: t[dst] },
  defaultFast,
  defaultSelfMint: true,
});

export const ROUTES = {
  usdc_av_arc: usdcRoute(43114, 5042, false),
  usdc_av_eth: usdcRoute(43114, 1, false),
  usdc_eth_arc: usdcRoute(1, 5042, true),
  usdc_arc_eth: usdcRoute(5042, 1, false),
  eurc_arc_eth: cctpxRoute(EURC, "EURC", 6, 5042, 1, false),
  cirbtc_eth_arc: cctpxRoute(CIRBTC, "cirBTC", 8, 1, 5042, true),
  cirbtc_arc_eth: cctpxRoute(CIRBTC, "cirBTC", 8, 5042, 1, false),
  weth_eth_arc: {
    ...cctpxRoute(WETH, "WETH", 18, 1, 5042, true),
    canWrap: true,
  },
  weth_arc_eth: cctpxRoute(WETH, "WETH", 18, 5042, 1, false),
};

const ZERO = "0x0000000000000000000000000000000000000000";
// Anything this app treats as a contract is not a wallet. Tokens sent there are lost.
export const NOT_A_RECIPIENT = new Set(
  [
    CCTS,
    TOKEN_MINTER_V2,
    MESSAGE_TRANSMITTER,
    ZERO,
    ...Object.values(ROUTES).flatMap((r) => [
      r.src.token,
      r.dst.token,
      r.tokenManager,
    ]),
  ].map((a) => a.toLowerCase()),
);

const arcUsdc = (r) => r.kind === "usdc" && r.src.chainId === 5042;

// Whole and fractional units, with trailing zeros stripped. "1" and "0.5", never "1.0".
function formatUnits(amount, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Amount MAX and connect leave behind. Zero except on Arc USDC.
export const maxFillReserve = (r) => (arcUsdc(r) ? ARC_MAX_RESERVE : 0n);

// Clause the MAX log appends. Empty when MAX holds nothing back.
export function maxFillSuffix(r) {
  const reserve = maxFillReserve(r);
  if (reserve === 0n) return "";
  const left = formatUnits(reserve, r.decimals);
  const name = CHAINS[r.src.chainId].name;
  return ` (${left} ${r.symbol} stays on ${name} for gas)`;
}

// Sentence for the route blurb. Empty when MAX does not hold a reserve back.
export function maxFillNote(r) {
  const reserve = maxFillReserve(r);
  if (reserve === 0n) return "";
  const name = CHAINS[r.src.chainId].name;
  const left = formatUnits(reserve, r.decimals);
  const floor = formatUnits(ARC_SPEND_RESERVE, r.decimals);
  return `MAX leaves ${left} ${r.symbol} on ${name} for gas. Send keeps at least ${floor} ${r.symbol}.`;
}

// Null when the balance covers the amount and the Arc spend floor.
// Get fee and Send both call this. Callers do not add their own chain check.
export function spendError(r, amount, bal) {
  if (bal < amount) return `Not enough ${r.symbol}.`;
  if (arcUsdc(r) && bal - amount < ARC_SPEND_RESERVE) {
    const floor = formatUnits(ARC_SPEND_RESERVE, r.decimals);
    const chain = CHAINS[r.src.chainId].name;
    return `Keep at least ${floor} ${r.symbol} on ${chain} for gas (${r.symbol} is the gas token there).`;
  }
  return null;
}

// Locks depend on the route alone. USDC always self-mints. Its fast tier exists only from Ethereum.
export const fastAllowed = (r) => r.kind !== "usdc" || r.src.chainId === 1;
export const selfMintLocked = (r) => r.kind === "usdc";

// Applies the checkbox values on top of the locks.
export function transferMode(r, input) {
  return {
    fast: fastAllowed(r) && !!input.fast,
    selfMint: selfMintLocked(r) ? true : !!input.selfMint,
  };
}

export const fastLabel = (r) =>
  fastAllowed(r)
    ? "Fast transfer (small fee)"
    : "Fast transfer is not available for USDC except from Ethereum";

export const routeLabel = (r) =>
  `${r.symbol}: ${CHAINS[r.src.chainId].name} → ${CHAINS[r.dst.chainId].name}`;

export const cleanLabel = (s) =>
  String(s || "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
export const badLabel = (s) => !s || /0x/i.test(s) || /wallet/i.test(s);

// One shape either way: { ok: true, entry } or { ok: false, error }.
// Callers branch on ok. A string is never an entry, and an entry is never an error.
// Address and label come from the address book (typed in, or read back from localStorage).
export function validEntry(e, getAddress) {
  let address;
  try {
    address = getAddress(String(e && e.address));
  } catch {
    return { ok: false, error: "not a valid address (check the checksum)." };
  }
  if (NOT_A_RECIPIENT.has(address.toLowerCase()))
    return {
      ok: false,
      error:
        "this is a token or Circle contract, not a wallet. Tokens sent there are lost.",
    };
  const label = cleanLabel(e.label);
  if (badLabel(label))
    return {
      ok: false,
      error:
        'enter a short label with letters or digits only (no addresses, not "wallet").',
    };
  return { ok: true, entry: { label, address } };
}

// Circle's minimumFee is in basis points and may be fractional. Fast transfers keep 2x headroom.
export function usdcMaxFee(amount, minimumFee, fast) {
  const feeBps = Number(minimumFee);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > MAX_USDC_FEE_BPS)
    throw new Error(
      `Circle's fee looks wrong (${minimumFee} bps). Refusing to send.`,
    );
  const hundredths = BigInt(Math.ceil(feeBps * 100));
  return ((amount * hundredths + 999999n) / 1000000n) * (fast ? 2n : 1n);
}

export const cctpxFeeJumped = (oldFee, newFee) =>
  newFee > (oldFee * 3n) / 2n + FEE_JUMP_SLACK;

export function feeNeedsConfirm(chainId, fee) {
  return fee > chain(chainId).feeConfirm;
}

export function quoteStillMatches(quotedFor, next) {
  if (!quotedFor) return false;
  return (
    quotedFor.key === next.key &&
    quotedFor.amount === next.amount &&
    quotedFor.to === next.to &&
    quotedFor.fast === next.fast &&
    quotedFor.selfMint === next.selfMint
  );
}
