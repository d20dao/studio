# Local development

## Start

Use Node.js 24 or newer and npm.

```sh
npm ci
npm run dev
```

The development URL is `http://127.0.0.1:5178`. The port is strict: an occupied port produces an error rather than silently selecting another URL.

`predev` copies the pinned Solidity compiler and a transitive closure of the public SDK/OpenZeppelin contract sources into generated, ignored local assets. No private keys or RPC credentials are involved.

## Checks and build

```sh
npm run check
npm run build
npm run preview
```

The static production output is `dist/`; preview uses `http://127.0.0.1:4178`. These commands do not publish a website or deploy a contract.

## Structure

```text
src/
  app/          Project screens and application state
  components/   Shared interface pieces and the D20DAO brand mark
  styles/       Design tokens and responsive workspace styling
  core/         Project model, validation, storage, generation, export
  compiler/     Worker client, compiler result types, diagnostics
  templates/    Standard NFT collection and consumer generators
public/
  compiler/     Worker plus compiler/dependency assets prepared locally
scripts/        Reproducible local compiler preparation
tests/          Project, persistence, metadata, generation, compiler and EVM checks
design/         Approved ImageGen concepts and reference screenshots
```

## Skeleton boundaries

- Local project configuration, generated file inspection, export, and compilation are independent modules.
- Project JSON uses schema 3, with nullable `collection.maxSupply` (`null` means unlimited) and `reveal.mode` (`shuffle`, `offset`, `token-hash`). The decoder reads schema 1/2, preserving numeric caps and other settings, removing the obsolete opening quota and selecting legacy shuffle behavior. The raw saved snapshot remains intact until the next ordinary save. Business validation reports missing or incompatible options separately.
- New-project generation produces actual ERC-1155 loot or ERC-721 reveal collections plus their consumers. Existing-project generation produces adapters and integration instructions. Neither profile claims to implement a complete sale or game economy.
- A successful browser compilation means that the supplied Solidity sources compiled with the reported compiler and settings. It does not prove correct economics, completed NFT integration, or deployment readiness.
- The browser resolves only the public dependency snapshot prepared from the pinned package. It does not fetch arbitrary imports or require a backend compiler service.
- Browser storage holds device-local drafts. Export project JSON for portability; remote metadata references are not a backup of the referenced asset bytes.
- Standard template behavior should be implemented and tested before widening the accepted feature combinations.

## Local data and preview behavior

Workspace writes validate the prospective snapshot and compare it with the expected saved version while holding a browser Web Lock. Clean tabs follow storage updates; unsaved or incomplete drafts show a conflict and remain available for download. Browsers without lock support work in memory and report the missing save capability.

Malformed projects are isolated when reading a workspace. An explicit recovery archives the untouched original before saving usable records. The recovery screen offers original-data and local-draft downloads.

Metadata previews resolve HTTPS, IPFS and Arweave references. ERC-1155 `{id}` uses the explicit uint256 token ID or the row-index default. JSON is limited to 256 KB, raster images to 5 MB, and requests to ten seconds. CORS and redirect failures are surfaced; local JSON is an alternative. Preview data is transient and does not silently change the generated project. PNG, JPEG, WebP, GIF and AVIF are supported; HTML, SVG, data URIs and animation embeds are outside this preview profile.

Configuration labels offer keyboard- and touch-accessible help popovers. The project toolbar exposes configuration issues and incomplete field edits in every project view. Issue actions navigate to the current field, expand its module when needed, and focus it without discarding unfinished numeric text. Keep `issue-navigation.ts` and each control's `data-field-path` aligned when adding fields; item draft identities use stable IDs across row changes.

CSV headers, format rules, examples and a downloadable template are available before choosing an import. The shared project toolbar exports the current generated bundle from every view, then explains how to extract it and direct an agent to `AGENTS.md`. Invalid configurations are explicitly labeled as plan ZIPs without Solidity. ZIP tests verify file contents and reject stale snapshots or unsafe archive paths; dependencies are declared with pinned versions, not bundled as `node_modules`.

Delete, workspace recovery and item-import review use the shared native `Modal`, with safe initial focus, Escape dismissal and focus restoration. Confirmations never expand a table row. Deletion undo stays in the fixed notification area. Modals, popovers, metadata cards and expandable sections use short state transitions and respect reduced-motion preferences.

## NFT template profiles

- ERC-1155 loot: one weighted reward per opening; explicit token IDs; total-unit supply including premint and outstanding reservations. Premint goes to the first configured item ID. A settled expired attempt releases its reservation; retry reacquires capacity. There is no separate lifetime opening quota in generator 0.3.0. `openTo` accepts a separate NFT recipient; the RNG refund recipient remains the caller. After acceptance, only the original requester may update an undelivered NFT recipient with `setDeliveryRecipient`, preserving the request, token, word and reserved supply. `deliver(requestId)` always uses the recorded recipient. Existing-project adapters leave inventory limits and eligibility to the host integration.
- ERC-721 reveal: sequential IDs, optional supply cap and owner-controlled distribution. `mintPremint(quantity)` distributes the fixed allocation before ordinary minting; `closeMint()` can close below a configured cap. Minting can continue during a pending reveal. A request freezes the next minted range; expired retries retain it. `finalizeReveal(requestId)` applies that accepted result once before another batch begins.
- Shuffle maps up to 256 tokens per SDK request. Offset uses NumberRange for all currently unrevealed minted tokens and applies a cyclic rotation. Per-token hash uses a raw word, a fixed domain, chain/contract identity, config digest and token ID; indexed URIs remain unchanged and an agent must implement seed-driven traits/rendering. Offset/hash store batches in constant work at finalization and resolve token ranges with binary search. These modes do not impose a collection-size cap.
- Existing reveal adapters use `requestReveal(batchKey, population)`, freeze that population for retries, and expose the selected result getter (`assignment`, `offset`/`metadataIndex`, or `tokenHash`). The host must freeze the actual token/metadata lists, enforce membership and prevent overlapping or renamed batches from rerolling the same NFTs.
- Owners/operators are explicit constructor arguments. Collection/controller wiring verifies the configuration digest and collection pointer and can be established only once.
- Royalty and premint choices are implemented for new collections. Application price, fee sponsorship, and custom protocol-refund routing remain visible integration requirements.
- New collections require metadata URIs before Solidity generation because their URI rules are fixed in the constructor. Incomplete metadata produces a planning bundle; existing-project adapters retain metadata as integration work.

`tests/evm-lifecycle.test.ts` runs generated contracts inside a local Hardhat EVM using a coordinator lifecycle double. It covers callback and notification failures, retries, reservation ordering, rejecting NFT recipients, optional caps, staged premint, minting during reveals, frozen batch boundaries and all reveal modes. It does not claim to test real onchain VRF acceptance or a live deployment.

## Next implementation milestones

1. Add a separately specified sale/sponsorship/refund accounting adapter when required by an integration.
2. Add generation comparison and explicit dependency/template upgrade flows.
3. Validate an exported integration in an independent game or NFT repository.
4. Review broader inventories, partial-supply reveals and additional metadata/media formats before expanding support.

## Website deployment

The production target is `https://studio.d20dao.org`. `wrangler.jsonc` deploys the Vite `dist/` output as a separate assets-only Cloudflare Worker named `d20dao-studio` in the domain's existing Cloudflare account. It does not change the main D20DAO website, add a backend, or deploy NFT contracts.

```sh
npm ci
npm run check
npm run deploy:check
npm run deploy
```

`deploy:check` builds and performs a local Wrangler dry run. `deploy` builds again before publishing. Wrangler uses the operator's existing authenticated session; credentials, `.dev.vars` and `.wrangler` state must remain outside Git. The custom-domain route lets Cloudflare provision DNS and TLS. Workers.dev and preview URLs are disabled.

Studio uses hash routes, so only `/` serves the app entry point. Missing asset paths return 404 rather than HTML, including missing compiler files. Compiler URLs revalidate their cache; the compiler manifest still checks the pinned asset hashes. The 0.8.28 compiler is unchanged; the Node-only `solc` dependency's temporary-file helper is overridden to patched `tmp` 0.2.7 in Studio and exported package declarations.

Browser drafts are scoped to their origin. To move a localhost draft to the hosted Studio, download its project JSON locally and import it on the production domain. Wallet-based contract deployment remains a separate future task.
