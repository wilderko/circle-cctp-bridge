import { ethers } from "ethers";
import { test, expect } from "bun:test";
import {
  CHAINS,
  CIRBTC,
  CCTS,
  EURC,
  FEE_JUMP_SLACK,
  FINALITY_FAST,
  FINALITY_STANDARD,
  MESSAGE_TRANSMITTER,
  NOT_A_RECIPIENT,
  ROUTES,
  TOKEN_MESSENGER_V2,
  TOKEN_MINTER_V2,
  USDC,
  ARC_MAX_RESERVE,
  ARC_SPEND_RESERVE,
  WETH,
  WRAP_MAX_RESERVE,
  WRAP_MIN_LEFT,
  badLabel,
  cctpxFeeJumped,
  cleanLabel,
  feeNeedsConfirm,
  fastAllowed,
  fastLabel,
  finality,
  quoteStillMatches,
  routeLabel,
  selfMintLocked,
  spendError,
  transferMode,
  usdcMaxFee,
  maxFillNote,
  maxFillReserve,
  maxFillSuffix,
  usdcRoute,
  validEntry,
} from "../logic.mjs";

const WALLET = "0x1111111111111111111111111111111111111111";
const entry = (e) => validEntry(e, ethers.getAddress);

test("cleanLabel keeps words and drops the rest", () => {
  expect(cleanLabel("  Home   safe!  ")).toBe("Home safe");
  expect(cleanLabel("a".repeat(30))).toHaveLength(24);
  expect(cleanLabel("<script>")).toBe("script");
});

test("badLabel rejects empty, 0x, and wallet", () => {
  expect(badLabel("")).toBe(true);
  expect(badLabel("0xabc")).toBe(true);
  expect(badLabel("My Wallet")).toBe(true);
  expect(badLabel("Cold storage")).toBe(false);
});

test("validEntry accepts a labelled wallet and rejects the rest", () => {
  const ok = entry({ label: "Cold storage", address: WALLET });
  expect(ok).toEqual({
    ok: true,
    entry: {
      label: "Cold storage",
      address: ethers.getAddress(WALLET),
    },
  });

  const reject = (e) => {
    const result = entry(e);
    expect(result.ok).toBe(false);
    return result.error;
  };
  expect(reject({ label: "0x friend", address: WALLET })).toMatch(/no addresses/);
  expect(reject({ label: "hardware wallet", address: WALLET })).toMatch(/wallet/);
  expect(reject({ label: "!!!", address: WALLET })).toMatch(/short label/);
  expect(reject({ label: "Cold", address: "0x1234" })).toMatch(/checksum/);
  expect(
    reject({
      label: "Cold",
      address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAED",
    }),
  ).toMatch(/checksum/);
  expect(reject({ label: "Nope", address: USDC[1] })).toMatch(/Circle contract/);
  expect(reject({ label: "Nope", address: TOKEN_MESSENGER_V2 })).toMatch(
    /Circle contract/,
  );
  expect(reject({ label: "Nope", address: CCTS })).toMatch(/Circle contract/);
  expect(reject({ label: "Nope", address: ethers.ZeroAddress })).toMatch(
    /Circle contract/,
  );
});

test("Arc MAX reserve is 1 USDC, and only on USDC routes", () => {
  expect(ARC_MAX_RESERVE).toBe(1_000000n);
  expect(ARC_SPEND_RESERVE).toBe(500000n);
  expect(maxFillReserve(ROUTES.usdc_arc_eth)).toBe(ARC_MAX_RESERVE);
  expect(maxFillReserve(ROUTES.usdc_eth_arc)).toBe(0n);
  expect(maxFillReserve(ROUTES.usdc_av_arc)).toBe(0n);
  expect(maxFillReserve(ROUTES.eurc_arc_eth)).toBe(0n);
  expect(maxFillReserve(ROUTES.weth_arc_eth)).toBe(0n);
  expect(maxFillReserve(ROUTES.cirbtc_arc_eth)).toBe(0n);
  expect(maxFillNote(ROUTES.usdc_arc_eth)).toBe(
    "MAX leaves 1 USDC on Arc for gas. Send keeps at least 0.5 USDC.",
  );
  expect(maxFillNote(ROUTES.usdc_eth_arc)).toBe("");
  expect(maxFillNote(ROUTES.eurc_arc_eth)).toBe("");
  expect(maxFillSuffix(ROUTES.usdc_arc_eth)).toBe(" (1 USDC stays on Arc for gas)");
  expect(maxFillSuffix(ROUTES.usdc_eth_arc)).toBe("");
  expect(maxFillSuffix(ROUTES.eurc_arc_eth)).toBe("");
});

test("spendError covers the amount and the Arc spend floor", () => {
  const arc = ROUTES.usdc_arc_eth;
  const amount = 10_000000n;
  expect(spendError(arc, amount, amount + ARC_MAX_RESERVE)).toBeNull();
  expect(spendError(arc, amount, amount + ARC_SPEND_RESERVE)).toBeNull();
  expect(spendError(arc, amount, amount + ARC_SPEND_RESERVE - 1n)).toBe(
    "Keep at least 0.5 USDC on Arc for gas (USDC is the gas token there).",
  );
  expect(spendError(arc, amount, amount - 1n)).toBe("Not enough USDC.");
  expect(spendError(ROUTES.eurc_arc_eth, 1n, 0n)).toBe("Not enough EURC.");
  expect(spendError(ROUTES.weth_eth_arc, 1n, 1n)).toBeNull();
});

test("transfer mode locks USDC self-mint and fast off Ethereum", () => {
  expect(fastAllowed(ROUTES.usdc_eth_arc)).toBe(true);
  expect(selfMintLocked(ROUTES.usdc_eth_arc)).toBe(true);
  expect(fastAllowed(ROUTES.usdc_av_arc)).toBe(false);
  expect(selfMintLocked(ROUTES.weth_arc_eth)).toBe(false);
  const eth = transferMode(ROUTES.usdc_eth_arc, { fast: false, selfMint: false });
  expect(eth).toEqual({ fast: false, selfMint: true });
  const av = transferMode(ROUTES.usdc_av_arc, { fast: true, selfMint: false });
  expect(av).toEqual({ fast: false, selfMint: true });
  const weth = transferMode(ROUTES.weth_arc_eth, { fast: true, selfMint: false });
  expect(weth).toEqual({ fast: true, selfMint: false });
  expect(fastLabel(ROUTES.usdc_eth_arc)).toBe("Fast transfer (small fee)");
  expect(fastLabel(ROUTES.usdc_av_arc)).toBe(
    "Fast transfer is not available for USDC except from Ethereum",
  );
  expect(fastLabel(ROUTES.weth_arc_eth)).toBe("Fast transfer (small fee)");
  expect(finality(true)).toBe(FINALITY_FAST);
  expect(finality(false)).toBe(FINALITY_STANDARD);
  for (const r of Object.values(ROUTES)) {
    const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
    if (!fastAllowed(r)) expect(mode.fast).toBe(false);
    if (selfMintLocked(r)) expect(mode.selfMint).toBe(true);
  }
  expect(WRAP_MAX_RESERVE).toBe(12_000_000_000_000_000n);
  expect(WRAP_MIN_LEFT).toBe(5_000_000_000_000_000n);
});

test("USDC max fee ceils fractional bps and doubles for fast", () => {
  const amount = 1_000000n;
  expect(usdcMaxFee(amount, 0, false)).toBe(0n);
  // 0.01 bps of 1 USDC is 0.000001 USDC, which ceils to 1 unit, then fast doubles it.
  expect(usdcMaxFee(amount, 0.01, false)).toBe(1n);
  expect(usdcMaxFee(amount, 0.01, true)).toBe(2n);
  // 1 bps of 10 USDC is 0.001 USDC.
  expect(usdcMaxFee(10_000000n, 1, false)).toBe(1_000n);
  expect(() => usdcMaxFee(amount, 20.01, false)).toThrow(/Refusing to send/);
  expect(() => usdcMaxFee(amount, -1, false)).toThrow(/Refusing to send/);
});

test("CCTPx fee jump allows 50 percent plus dust", () => {
  const oldFee = 1_000000000000000000n;
  const ceiling = (oldFee * 3n) / 2n + FEE_JUMP_SLACK;
  expect(cctpxFeeJumped(oldFee, ceiling)).toBe(false);
  expect(cctpxFeeJumped(oldFee, ceiling + 1n)).toBe(true);
});

test("fees at the confirm threshold do not ask again", () => {
  expect(CHAINS[1].feeConfirm).toBe(3_000_000_000_000_000n);
  expect(CHAINS[5042].feeConfirm).toBe(3_000_000_000_000_000_000n);
  expect(CHAINS[43114].feeConfirm).toBe(200_000_000_000_000_000n);
  expect(FEE_JUMP_SLACK).toBe(100_000_000_000_000n);
  expect(feeNeedsConfirm(1, CHAINS[1].feeConfirm)).toBe(false);
  expect(feeNeedsConfirm(1, CHAINS[1].feeConfirm + 1n)).toBe(true);
  expect(feeNeedsConfirm(5042, CHAINS[5042].feeConfirm)).toBe(false);
  expect(feeNeedsConfirm(43114, CHAINS[43114].feeConfirm + 1n)).toBe(true);
  expect(() => feeNeedsConfirm(999, 1n)).toThrow(/Unknown chain/);
  expect(() => usdcRoute(999, 1, false)).toThrow(/Unknown chain/);
});

test("a quote matches only the same route, amount, recipient, and mode", () => {
  const quoted = {
    key: "usdc_eth_arc",
    amount: 5n,
    to: WALLET,
    fast: true,
    selfMint: true,
  };
  expect(quoteStillMatches(quoted, { ...quoted })).toBe(true);
  expect(quoteStillMatches(null, quoted)).toBe(false);
  expect(quoteStillMatches(quoted, { ...quoted, amount: 6n })).toBe(false);
  expect(quoteStillMatches(quoted, { ...quoted, key: "usdc_arc_eth" })).toBe(
    false,
  );
  expect(quoteStillMatches(quoted, { ...quoted, to: USDC[1] })).toBe(false);
  expect(quoteStillMatches(quoted, { ...quoted, fast: false })).toBe(false);
  expect(quoteStillMatches(quoted, { ...quoted, selfMint: false })).toBe(false);
});

test("every route points at a known domain, token, and manager", () => {
  expect(CHAINS[1].domain).toBe(0);
  expect(CHAINS[43114].domain).toBe(1);
  expect(CHAINS[5042].domain).toBe(26);
  const wrap = [];
  for (const [key, r] of Object.entries(ROUTES)) {
    expect(r.src.domain).toBe(CHAINS[r.src.chainId].domain);
    expect(r.dst.domain).toBe(CHAINS[r.dst.chainId].domain);
    expect(r.src.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.dst.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.tokenManager).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.defaultSelfMint).toBe(true);
    if (r.kind === "usdc") expect(r.tokenManager).toBe(TOKEN_MESSENGER_V2);
    if (r.canWrap) wrap.push(key);
    for (const a of [r.src.token, r.dst.token, r.tokenManager])
      expect(NOT_A_RECIPIENT.has(a.toLowerCase())).toBe(true);
    expect(routeLabel(r)).toContain(r.symbol + ": ");
  }
  for (const a of [
    CCTS,
    TOKEN_MINTER_V2,
    MESSAGE_TRANSMITTER,
    ethers.ZeroAddress,
  ])
    expect(NOT_A_RECIPIENT.has(a.toLowerCase())).toBe(true);
  expect(routeLabel(ROUTES.usdc_av_arc)).toBe("USDC: Avalanche → Arc");
  expect(routeLabel(ROUTES.weth_arc_eth)).toBe("WETH: Arc → Ethereum");
  expect(wrap).toEqual(["weth_eth_arc"]);
  expect(ROUTES.eurc_arc_eth.tokenId).toBe(EURC.tokenId);
  expect(ROUTES.cirbtc_eth_arc.tokenManager).toBe(CIRBTC.manager);
  expect(ROUTES.weth_arc_eth.src.token).toBe(WETH[5042]);
});
