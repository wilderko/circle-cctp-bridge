# Circle CCTP Bridge

A browser page that moves **USDC, EURC, cirBTC and WETH** between **Arc, Ethereum and Avalanche** through Circle's own contracts:

- **USDC** goes through Circle **CCTP V2** (`depositForBurn`, then `receiveMessage` on the destination).
- **EURC, cirBTC and WETH** go through Circle's cross-chain token service, also called "CCTP for non-USDC" or CCTPx (`crossChainTransfer` on `CrossChainTokenService`).

A standard transfer costs **no protocol fee**, so you pay only gas. Bridge apps typically charge 0.05–0.5% of every transfer. On large amounts that is real money: 0.25% of $100,000 is $250.

There is no backend, no account and no analytics. The page runs in your browser and your wallet signs every transaction.

> ⚠️ **Disclaimer: use entirely at your own risk.** This is an unaudited personal tool. It was written with an AI coding agent (Claude Code) and used with real funds on every route listed below, which makes it tested, not audited. The authors accept **no liability** for any loss of funds, bugs, misuse or abuse of this software, or for any damage arising from its use. You are solely responsible for every transaction you sign. Always try a small amount first.

Background: [How to live off a crypto loan, chapter 2.10](https://liberation.travel/live-off-crypto-loan-legally-pay-no-tax-2026/#aave-v4). The page was built to move Aave v4 positions between Arc, Ethereum and Avalanche cheaply.

## Routes

| Route                      | Protocol                              | Typical time                                            |
| -------------------------- | ------------------------------------- | ------------------------------------------------------- |
| USDC: Avalanche → Arc      | CCTP V2                               | seconds                                                 |
| USDC: Avalanche → Ethereum | CCTP V2                               | seconds                                                 |
| USDC: Ethereum → Arc       | CCTP V2                               | ~15–20 min standard, or seconds with "fast" (small fee) |
| USDC: Arc → Ethereum       | CCTP V2                               | seconds                                                 |
| EURC: Arc → Ethereum       | CCTPx                                 | seconds to minutes                                      |
| cirBTC: Ethereum → Arc     | CCTPx                                 | ~15–20 min standard, or faster with "fast"              |
| cirBTC: Arc → Ethereum     | CCTPx                                 | seconds to minutes                                      |
| WETH: Ethereum → Arc       | CCTPx (with optional ETH → WETH wrap) | ~15–20 min standard, or faster with "fast"              |
| WETH: Arc → Ethereum       | CCTPx                                 | seconds to minutes                                      |

The time is mostly Circle's attestation. Transfers that start on Ethereum wait for Ethereum finality unless you choose "fast".

## How to run it

Wallet extensions do not inject into `file://` pages reliably, so serve the folder locally:

```bash
git clone https://github.com/wilderko/circle-cctp-bridge.git
cd circle-cctp-bridge
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000> in a browser with **Rabby** or **MetaMask**. Ideally use a hardware wallet as the signer.

The safety checks have a Bun test suite. Install and run them with Bun:

```bash
bun install
bun test
```

## How a transfer works

1. Pick the **route** and the **recipient**. The recipient is the connected wallet by default. To send to another address of yours, add it under "My other addresses" first.
2. **Connect wallet.** The page switches your wallet to the source network and checks Circle's contracts on-chain.
3. Enter the **amount** (or click MAX) and click **Get fee**.
4. **Approve** the exact amount, then **Send**.
5. If you sign the mint yourself (the default), the page waits for Circle's attestation and then switches your wallet to the destination network. There you sign `receiveMessage`, the mint. You need a little gas on the destination network for that: ETH on Ethereum, USDC on Arc, AVAX on Avalanche.

For EURC, cirBTC and WETH you can instead untick "I sign the mint myself". Circle then delivers the tokens for a forwarding fee, which you pay in the source network's gas token.

**Closed the page before the mint?** The transfer is not lost. Open the page again, pick the same route, connect, and paste the source-chain transaction hash under **Finish a pending transfer**.

## Safety features

- **On-chain contract checks before every transfer.** For USDC it checks `TokenMessengerV2.localMinter()`. For the other tokens it checks `CrossChainTokenService.resolveTokenManager()` and `resolveTokenAddress()` against the addresses in the code.
- **Recipient allowlist.** The recipient is either the connected wallet or an address from your own address book, which is stored only in your browser. There is no free-text recipient field, which protects against address poisoning (look-alike addresses planted in your transaction history).
- **Address book hardening.**
  - Entries are re-validated every time the page loads. `validEntry` returns either `{ ok: true, entry }` or `{ ok: false, error }`. The page keeps an entry only when `ok` is true, and shows `error` when an add fails. A bad saved entry is dropped and counted in the log.
  - Labels are plain words only, so a label cannot pretend to be an address or "This wallet".
  - Token and Circle contract addresses are refused as recipients.
- **Extra confirmation for other addresses.** Before funds go to an address other than the connected wallet, the page shows the full address in a confirmation dialog. It also warns if that address is a smart contract on the destination network.
- **One action at a time.** All buttons are locked while a transaction is pending, so a double click cannot send twice.
- **Exact approvals.** The page never asks for an unlimited allowance.
- **Fee guards.**
  - A Circle USDC fee above 0.2% is refused.
  - For EURC, cirBTC and WETH the page fetches a fresh quote right before sending. It refuses a fee that jumped by more than 50%, and asks for confirmation above a small threshold.
  - Each quote is used only once.
- **Safe resume.** "Finish a pending transfer" checks with Circle that the transfer really goes from and to the networks of the selected route before switching networks. It stops after 2 minutes if Circle does not know the hash.
- **Balance check.** Get fee and Send both refuse when the token balance cannot cover the amount. On Arc USDC, Send keeps at least 0.5 USDC for gas. MAX and the amount filled in on connect leave 1 USDC.
- **Strict Content-Security-Policy.**
  - No inline scripts.
  - Scripts load only from this folder and the pinned library.
  - Network requests can go only to Circle's API and the three public RPC endpoints.
  - Wallet extensions such as Rabby and MetaMask still work.
- **Pinned library.** ethers.js 6.13.2 is pinned with a Subresource Integrity hash.
- **No embedding.** The page refuses to run inside a frame of another site (clickjacking).

### Good practice

- Run it from a clone of this repository, not from a copy hosted by someone else. A modified copy could send funds anywhere.
- Smart contract wallets (for example a Safe) can have a different address, or no deployment at all, on another network. Bridge to them only if you know the address exists on the destination.
- Read what your wallet shows before signing: the contract, the amount and, for the transfer, the value of the native fee.

## Fees

- **USDC, standard:** 0 protocol fee. You pay gas on the source network, plus gas for the mint on the destination network.
- **USDC, fast (from Ethereum only):** Circle's current fast-transfer fee, fetched live. It was about 0.25 bps when this was written. The page allows up to 2× that, so a small fee change does not fall back to a standard transfer.
- **EURC, cirBTC, WETH:** 0 protocol fee when you sign the mint yourself. If Circle mints for you, there is a forwarding fee in the source network's gas token. The page always shows the quote before you sign.

Circle applies per-transfer limits, for example at most 9 cirBTC per transfer at the time of writing.

## Contract addresses

The Circle contracts have the same address on Ethereum, Arc and Avalanche:

| Contract                | Address                                      |
| ----------------------- | -------------------------------------------- |
| TokenMessengerV2 (USDC) | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| TokenMinterV2           | `0xfd78EE919681417d192449715b2594ab58f5D002` |
| MessageTransmitterV2    | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| CrossChainTokenService  | `0x431871229103b780868f8C6BB820cd16ECf942BC` |

Tokens:

| Token  | Ethereum                                     | Arc                                                                            | Avalanche                                                         |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| USDC   | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0x3600000000000000000000000000000000000000` (ERC-20 interface of native USDC) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (native, not USDC.e) |
| EURC   | `0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`                                   | –                                                                 |
| cirBTC | `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E` | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`                                   | –                                                                 |
| WETH   | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB`                                   | –                                                                 |

Fake cirBTC tokens circulate on Arc, so compare the address before you trade or bridge.

Official references: [Circle CCTP docs](https://developers.circle.com/cctp), [CCTP for non-USDC tokens](https://developers.circle.com/cctp/expanded-assets), [cirBTC addresses](https://developers.circle.com/assets/cirbtc-contract-addresses), [Arc RPC endpoints](https://docs.arc.io/arc/references/rpc-endpoints).

## Troubleshooting

- **"Circle returned an already expired quote" or a `QuoteExpired` revert:** quotes are valid for only a few blocks. Click **Send** again, because it fetches a fresh quote.
- **"Insufficient balance" on Arc:** USDC is both the token and the gas there. Leave some USDC for gas.
- **"This transfer has already been minted":** the mint already happened. Check the destination balance.
- **The wallet shows "Value diff −100%"** for tokens it has no price for, such as some BTC wrappers. Check the token address instead.
- **A cached old version of the page:** reload with Ctrl+Shift+R.

## Files

- `index.html`: the page with its Content-Security-Policy.
- `app.js`: the page.
- `logic.mjs`: the safety checks, also covered by `bun test`.
- `style.css`: the styles.

## Adding a route

Routes live in the `ROUTES` object in `logic.mjs`. The dropdown is built from that object. A USDC route needs only the two chains (`usdcRoute(src, dst, defaultFast)`). A CCTPx route needs the token's `tokenId`, its TokenManager and the token addresses on both chains. You can list the token IDs from Circle's API (`GET https://iris-api.circle.com/v2/cctpx/tokens`). A new chain also needs an entry in `CHAINS`, including its Circle domain and fee-confirmation threshold, and its RPC host in the `connect-src` of the Content-Security-Policy in `index.html`. A route that names an unknown chain fails when the page loads. Check every new route with a small amount first.

## Reporting a security issue

Open an issue on GitHub. If the issue could put funds at risk, describe the problem in general terms first and leave out a working exploit.

## Disclaimer

This software is provided "as is", without warranty of any kind. Use it entirely at your own risk. The authors and contributors are **not liable** for any loss of funds, failed or stuck transfers, bugs, changes in Circle's contracts or APIs, misuse or abuse of this software by anyone, or any other damage arising from its use. Nothing here is financial, legal or tax advice. You are solely responsible for checking every transaction before you sign it.

## License

MIT, see [LICENSE](LICENSE).
