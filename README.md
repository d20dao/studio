# D20DAO Studio

Product specification and implementation brief

- **Production domain:** [studio.d20dao.org](https://studio.d20dao.org)
- **Created:** September 22, 2026
- **Status:** Studio v0.3.1 demo / beta, including local project configuration, metadata previews and NFT boilerplate generation. Do not use exported code as-is: have your agent customize it, then review and test the result before deployment. The product specification below also includes later capabilities.
- **Primary audience:** Game developers and NFT project teams.
- **Primary objective:** Help independent projects adopt D20DAO by turning their game or NFT mechanic into a practical integration starter.
- **Interface studies:** [ImageGen concepts and design references](design/README.md), prepared with the requested Astra medium agent. These are visual studies, not an implemented Studio application.

## Run the current skeleton

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5178`. See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, checks, and build commands.

Generated `AGENTS.md`, `AGENT_PROMPT.md` and README files include direct D20DAO documentation links, the selected Arc network's deployment manifest, and paths to the pinned SDK's own agent/API/provenance documents. Public web references can change; the installed SDK version remains the source for exact API behavior.

The current React/TypeScript/Vite application implements:

- Local projects with duplicate/delete/undo, JSON import/export, hash navigation, remembered views, conflict-aware saves, and explicit recovery of malformed storage.
- Lootbox/reveal configuration, weighted probability summaries, optional token IDs, premint/royalty settings, and payment/recovery choices.
- Metadata thumbnails and accessible NFT cards, bounded HTTPS/IPFS/Arweave loading, local JSON fallback, and previewed JSON/CSV item import.
- A file browser with syntax highlighting, line numbers, compiler diagnostic navigation, ZIP export, and project-specific agent instructions.
- New-project ERC-1155 loot or ERC-721 reveal collections with configured premint, ERC-2981 royalty signaling, supply limits, and authenticated VRF consumers. Existing-project exports remain adapters and instructions. Invalid configuration produces a planning bundle without Solidity.
- Real client-side Solidity 0.8.28 compilation in a worker, using pinned SDK 0.4.0 and OpenZeppelin 5.6.1 sources, with cancellation and ABI/bytecode inspection/download.
- Project, persistence, metadata, generator, compiler, and local EVM lifecycle tests, plus a static production build and CI configuration.

**Current boundary:** new-project templates implement their documented NFT/VRF behavior; application sale pricing, fee sponsorship, custom refund routing, and game-specific eligibility remain explicit integration work. Existing-contract integration still depends on that contract's interface and permissions. Callbacks store the accepted word; bounded application delivery/finalization is a separate transaction and is not a mandatory Studio onboarding step. Local EVM tests use a coordinator lifecycle double, not live cryptographic proof acceptance. No live deployment or hosted publication is included.

## 1. Product concept

D20DAO Studio is a visual project builder for verifiable game and NFT mechanics. A developer chooses what they want to build, completes onboarding specific to that mechanic, configures optional features, and exports a project specification, boilerplate code, and agent implementation instructions.

For example, a developer chooses **Lootbox**, names the box, defines its assets and item metadata, sets drop probabilities, selects payment and refund behavior, and receives a project they can continue in their own repository or with a coding agent.

The generated project does not have to be deployment-ready in the first version. It must be useful, internally consistent, explicit about unfinished integration points, and grounded in the real D20DAO SDK.

The core workflow is:

**Choose a mechanic → configure the project → validate the choices → preview the behavior → export code and agent instructions → integrate into an application.**

## 2. Decisions captured from the discussion

The following points define the requested product:

- Use `studio.d20dao.org` as the intended product address.
- Focus on adoption by games and NFT projects.
- Allow users to create and revisit projects locally.
- Adapt onboarding to the selected mechanic, starting with examples such as lootboxes and NFT reveal.
- Collect real project inputs: names, assets, metadata, drop chances, and application rules.
- Support expandable feature modules, including royalties and premint.
- Generate boilerplate code and/or a project-specific agent prompt.
- Include D20DAO SDK references and explain how agents should implement the selected behavior.
- Treat request tracking, callbacks, refunds, and recovery as part of the generated application design.
- Make the outputs useful even when additional implementation is required before deployment.

The local browser persistence model, file layout, module architecture, phased roadmap, and specific feature details below are proposed implementation choices. They make the agreed concept concrete without implying that every feature belongs in the first release.

## 3. Audience and value

### Game developers

Typical needs include loot drops, reward packs, crafting outcomes, character evolution, randomized encounters, and public tournament or draft ordering.

Studio should provide the complete integration around randomness: application action identity, request creation, waiting states, result interpretation, delivery, and failure recovery.

### NFT project teams

Typical needs include collection reveal, mystery packs, randomized attributes, premint handling, and post-launch crafting or evolution mechanics.

Studio should let a team use its own collection and assets, understand the relevant contract permissions, and produce a verifiable result that can be presented on its own website.

### Adoption model

A team should be able to:

1. Try a working example.
2. Replace the sample assets and rules with its own.
3. Export a usable integration starter.
4. Complete the integration in its own project.
5. Share a result or proof page that identifies D20DAO as the randomness provider.

Independent integrations and continued usage are the main success signals. Activity generated by D20DAO's own demos should be reported separately.

## 4. Product scope

### Initial product direction

- A local-first web application.
- A project dashboard and mechanic-specific configuration flows.
- Validated, versioned project specifications.
- Preview and simulation tools.
- Reviewed code templates.
- Project-specific documentation and agent prompts.
- Downloadable project bundles and portable project files.

### Not required for the initial version

- Automatic mainnet deployment or wallet signing.
- Custody of user funds, NFTs, or signing credentials.
- A full NFT marketplace or general-purpose launchpad.
- An entire multiplayer game or game economy platform.
- An unrestricted combination of every contract feature.
- A hosted AI service required to generate the basic project.
- New D20DAO chain deployments.

These boundaries keep the first release focused. Features can be added when a reviewed implementation and a real use case exist.

## 5. User journey

### 5.1 Project dashboard

Users can create, rename, duplicate, reopen, export, import, and delete local projects. Each project shows its mechanic, last edit, configuration completeness, and generation status.

The proposed first version stores projects in the browser and supports explicit JSON export/import. It should explain that browser storage is local to that device and may be cleared. A downloaded project file is the portable backup.

Account-based synchronization is a future option, not an initial requirement.

### 5.2 Choose a mechanic and integration context

Initial mechanic choices:

- Lootbox / reward pack.
- NFT reveal.

Later candidates:

- Crafting and NFT evolution.
- Randomized encounter or expedition.
- Public tournament, team, or draft selection.

Proposed integration contexts:

- Start a new consumer or collection.
- Add a mechanic to an existing compatible contract.
- Add verifiable rewards to an existing game.

Existing-contract support requires a known interface and the necessary permissions or extension points. Studio must not imply that an immutable deployed contract can always gain new mint or reveal functionality.

### 5.3 Guided configuration

Show the fields relevant to the selected mechanic. Common project settings are shared, while optional features expand into their own configuration panels.

Use progressive disclosure: a basic loot project should not require a user to answer every possible NFT sale, royalty, crafting, and administration question.

An always-visible project summary should explain the resulting behavior in plain language.

### 5.4 Validation and preview

Before export, show:

- Missing required values.
- Invalid values and incompatible feature combinations.
- SDK or template limits.
- Unresolved integration decisions.
- A human-readable description of the configured behavior.
- A clearly labeled local simulation where appropriate.

A simulated draw is not an accepted D20DAO request and must never appear as production proof.

### 5.5 Export and continue

Provide separate actions for:

- Download project JSON.
- Download boilerplate ZIP.
- Copy or download the agent implementation prompt.
- Read the generated integration guide.

Users can edit the local project and regenerate the outputs. Regeneration must preserve configuration consistency; the first version should export a fresh bundle rather than silently overwrite a user's separately edited application repository.

## 6. Expandable feature system

Each feature should be a versioned module with:

1. Configuration fields and user-facing explanations.
2. Defaults and validation rules.
3. Dependencies and incompatible combinations.
4. Code-template contributions.
5. Documentation and agent-prompt contributions.
6. Relevant behavioral test scenarios.

A feature is supported only when its generated behavior and interactions are understood. A visible future feature should be labeled as planned, rather than producing a misleading stub that appears complete.

| Feature group | Configuration examples | Important interactions |
| --- | --- | --- |
| Collection | ERC-721 or ERC-1155, name, symbol, maximum supply, metadata | Template support, mint rights, reveal strategy |
| Premint | Amount, recipients, token allocation, timing | Total supply, public allocation, reveal participation |
| Mint access | Public mint, allowlist, per-wallet limit, mint window | Premint, reserved supply, committed reveal groups |
| Royalties | Enabled, recipient, percentage, change policy | NFT standard, administration, generated documentation |
| Loot | Items, integer weights, items per pack, duplicate rules | Stock, request binding, allocation order |
| Reveal | Token set, metadata pool, trigger, authorized caller | Mint closure, premint, immutable commitments |
| Payments | Free or paid interaction, price, payer of RNG fee, revenue recipient | Escrow, overpayment, refund liabilities |
| Recovery | Expiry behavior, callback retry, claim, application refund | Accepted result identity, asset custody |
| Administration | Owner and roles, pause, update and withdrawal powers | Pending requests, committed rules, refundable balances |

Not every row must be implemented in the MVP. In particular, multiple token standards, advanced mint phases, finite-stock allocation, and complex role systems should be introduced deliberately.

### 6.1 Royalties

Royalty configuration should produce the selected ERC-2981-compatible behavior and the matching instructions and tests.

Collect the receiver, rate, and whether any authorized update is allowed. Represent the rate internally with explicit integer units such as basis points.

ERC-2981 communicates royalty information; it does not force every marketplace to pay royalties. Studio's UI and generated README must state this accurately.

Royalty revenue, initial sale proceeds, and D20DAO service fees are separate concepts.

### 6.2 Premint and supply

Premint configuration should specify recipients, quantities, and participation in the reveal pool.

Required rules include:

- Premint cannot exceed the maximum supply.
- Premint and reserved allocations must be reflected in the remaining public allocation.
- Reserved supply and already minted supply must not be counted twice.
- A reveal must identify exactly which tokens are included.
- The relevant token set, supply, and metadata pool must be fixed before randomness is known.
- A later mint must not silently change the inputs of an existing reveal.
- The generated contract must enforce supply rules; they cannot exist only in the Studio form.

## 7. Lootbox and reward-pack builder

This is the proposed first complete workflow because games can use it repeatedly and it also applies to NFT mystery packs.

### Inputs

- Project and box name.
- Reward type: game item or NFT, within the selected template's capabilities.
- Asset name, description, image reference, metadata URI or supported metadata fields.
- Item identifier and optional rarity label.
- Integer selection weights and displayed percentages.
- Number of rewards per opening.
- Whether duplicates are allowed within an opening.
- Whether rewards are independent draws or drawn from finite stock.
- Who may open a box and the application action that grants access.
- Free or paid opening, RNG payer, and recovery policy.

The MVP should define a small, explicit asset and metadata format. Local asset previews do not imply that Studio hosts those assets permanently; exported projects must identify their final hosting or content-addressed storage requirements.

### Example

**Ancient Chest** contains one independently selected reward per opening:

| Reward tier | Weight | Displayed chance |
| --- | ---: | ---: |
| Common | 600 | 60% |
| Rare | 300 | 30% |
| Legendary | 100 | 10% |

The output summary should state that a 10% chance does not guarantee exactly ten legendary rewards in every hundred openings.

Drop probability and stock quantity are separate settings. A finite inventory requires an allocation design that handles reservations, concurrent requests, and exhaustion consistently.

### Runtime flow

1. Validate the player's action and the applicable loot-table version.
2. Fix the relevant inputs and associate the action with one randomness request.
3. Show a pending state while waiting for an accepted result and delivery.
4. Store the authenticated result in a small callback.
5. Resolve the reward using the committed rules.
6. Complete NFT minting, item delivery, or claiming in an idempotent application step.
7. Present the recorded reward, configuration reference, and verification link.

Animations reveal the recorded outcome. Reopening a screen or retrying delivery must not draw a different reward.

### Existing SDK starting point

The SDK already includes `examples/LootDropConsumer.sol`, which demonstrates weighted reward tiers by mapping a random number range in consumer code. Weighted loot is not a separate built-in coordinator mapping operation.

Configurable loot tables therefore need their own version and commitment, bound to the request and available for replay.

## 8. NFT reveal builder

The reveal workflow should generate the integration for a compatible collection and a public explanation of its assignment process.

### Inputs

- New collection or existing compatible collection.
- Collection identity and contract interface requirements.
- Relevant supply and token IDs.
- Premint inclusion or exclusion.
- Ordered metadata pool and content commitment.
- Reveal group or campaign identity.
- Mint closure or eligibility cutoff.
- Reveal trigger and permissions.
- Assignment algorithm and version.
- Metadata mutability and finalization policy.

### Runtime flow

1. Commit the metadata pool and assignment rules before randomness is known.
2. Close and fix the token set participating in this reveal.
3. Request randomness bound to this reveal operation.
4. Store the accepted word through the authenticated callback.
5. Produce the deterministic token-to-metadata assignment.
6. Complete the collection's supported reveal or claim process.
7. Publish the assignment data and a verification page or tool.

### Collection size and truthful scope

At the planning baseline, the SDK's built-in `chooseOne`, `chooseMany`, and `shuffle` population limit is 256. The first reveal example should stay within the supported size; 64 or 128 items is a practical demonstration scope.

A large collection needs a separately reviewed assignment design. One raw VRF word can seed an application-defined deterministic off-chain assignment algorithm, but this does not extend the built-in shuffle limit or automatically provide onchain enforcement of that assignment.

A publisher-provided Merkle root proves membership in its committed output, not by itself that the output was correctly derived from the VRF word. The generated documentation must explain the verification boundary of the selected design.

Do not describe a random starting offset as a complete shuffle. Do not promise that all possible large-collection permutations are sampled uniformly from a single 256-bit word without a justified algorithm and claim.

## 9. Future mechanics and adoption showcase

### Crafting and NFT evolution

Possible mechanics include combining materials into a weapon, evolving a character, or exchanging cards for a new randomized item.

The project must bind the selected recipe, inputs, and outcome rules before requesting randomness. Material custody, expiry returns, and final consumption or minting require an application-level state machine.

Introduce a small number of reviewed recipes after loot and reveal integrations are validated.

### Randomized encounters and expeditions

A small reference game can demonstrate the exported integrations:

**Choose an NFT character and loadout → start an expedition → resolve a committed encounter → receive a reward pack → use its items in crafting.**

A suggested demonstration scope is three characters, three regions, and roughly twenty items. Partner projects could supply their own assets.

The game supports developer adoption and should expose reusable integration code. It should not become a separate large game-production commitment before the core tools are useful.

### Public and hidden outcomes

Accepted randomness is public. Future hidden cards or unopened rewards derived from an already public seed can be calculated.

Public map generation and committed encounter resolution can use this model. A private deck, hidden future loot sequence, or similar mechanic needs an additional design; Studio must not imply that VRF provides secrecy.

## 10. Canonical project specification

All outputs must derive from one validated, versioned project specification. The form state, generated contracts, README, test scenarios, and agent prompt must not evolve as separate sources of truth.

Proposed specification groups:

| Group | Contents |
| --- | --- |
| Identity | Schema version, project ID, name, mechanic, timestamps |
| Integration | New or existing project, token standard, required interfaces |
| Dependencies | Pinned SDK version, template version, relevant library versions |
| Network | Chain ID, coordinator reference, deployment manifest, provenance references |
| Assets | Stable item IDs, metadata, image references, content commitments |
| Supply | Maximum supply, premint, reservations, reveal token set |
| Randomness | Operation, mapping parameters, algorithm version, committed inputs |
| Features | Enabled modules and their validated configuration |
| Payments | Application price, RNG payer, fixed refund recipient, escrow policy |
| Recovery | Behavior for each request, delivery, refund, and finalization state |
| Administration | Roles, allowed changes, freeze points, withdrawal constraints |
| Generation | Supported outputs, unresolved inputs, validation and verification status |

The exact schema is an implementation decision. It should support explicit migrations when future Studio versions add or change fields.

## 11. Generation architecture and outputs

Recommended pipeline:

**Validated project specification → feature compatibility checks → versioned templates → code, documentation, tests, and agent instructions.**

Use reviewed templates for supported code generation. The first version can generate prompts locally without calling an AI service.

Unsupported combinations may still produce an honest design brief and agent planning prompt, but must not be presented as complete executable boilerplate.

### Proposed export layout

```text
ancient-chest/
  studio.project.json
  GENERATION-MANIFEST.json
  contracts/
    AncientChestConsumer.sol
  config/
    loot-table.json
  examples/
    request-and-read.ts
  tests/
  README.md
  AGENTS.md
  AGENT_PROMPT.md
```

This is the target generated-project layout. The current generator exports its implemented subset; client examples and generated application behavior tests remain later work.

The generation manifest should record template and dependency versions, the project specification identity, generated files, unresolved integration points, and which checks actually ran.

### Output readiness

Distinguish at least:

- **Configuration incomplete:** required decisions are missing.
- **Configuration valid:** fields and supported combinations pass Studio validation.
- **Boilerplate generated:** templates have been rendered.
- **Locally verified:** the reported compile or behavioral checks actually passed.
- **Integration work required:** explicit hooks, assets, permissions, or application logic remain.

These states may overlap; they should not collapse into a single misleading success badge. Generating or compiling code does not establish deployment readiness, an audit, or live-network validation.

## 12. D20DAO SDK and agent implementation contract

The planning baseline is the locally inspected `@d20dao/vrf-sdk` 0.4.0 source. Generator releases should pin a reviewed SDK and template combination rather than silently selecting the newest package.

Every generated project should reference:

- The installed SDK's `AGENTS.md`.
- The installed `API.md`, declarations, and ABIs for exact interfaces.
- `PROTOCOL-PROVENANCE.json` for the copied protocol source.
- The relevant packaged examples, such as `LootDropConsumer.sol`.
- The selected network's deployment manifest and historical implementation context.
- D20DAO integration, verification, and service-rules documentation.

Generated agent instructions should require the agent to:

1. Read the project specification and selected SDK references before changing code.
2. Implement only the selected features and explicitly identify missing project inputs.
3. Match the selected deployment with the reviewed SDK and protocol context.
4. Submit requests through a consumer contract and associate each request ID with an application action.
5. Quote the fee using the supported flow: `quoteFee` inside the requesting transaction; `quoteRequestFee` or `quoteFeeAt` with a current block base fee for an off-chain quote.
6. Account for any fee buffer or overpayment credit.
7. Keep callbacks authenticated and small, recording the accepted result with duplicate handling.
8. Complete minting, transfers, reward delivery, and other expensive application actions separately and idempotently.
9. Implement the selected recovery and refund policies without rerolling accepted outcomes.
10. Preserve committed inputs and outstanding asset or refund liabilities.
11. Run the applicable compile and behavioral checks, and report exactly what was verified.

### Example generated agent brief

> Implement Ancient Chest from the attached Studio project specification. Use its pinned D20DAO SDK version and read the packaged AGENTS.md, API.md, declarations, examples, and PROTOCOL-PROVENANCE.json. Use the configured item IDs, metadata references, weights, permissions, and payment policy. Bind each opening to its loot-table version and randomness request ID. Store the authenticated callback result, then complete reward delivery in a separate idempotent action. Handle expiry, callback retry, refund credits, and application-payment recovery as distinct states. Keep accepted outcomes unchanged. Implement the selected premint and royalty behavior where applicable, validate their interactions with supply and reveal, and report incomplete integration points and checks performed.

The actual prompt must be generated from the selected mechanic and modules, not include irrelevant features or unresolved placeholders disguised as completed decisions.

## 13. Request, delivery, and refund behavior

The application must track request creation, proof acceptance, callback delivery, application finalization, protocol refunds, refund credits, and refund notifications separately.

The protocol's 60-second window is a proof-acceptance deadline. It is not a guarantee that an NFT has been minted or every application action has completed within 60 seconds.

### Separate accounting domains

- **D20DAO RNG fee:** the service fee paid to the coordinator.
- **Fee overpayment:** excess value that may become refund credit.
- **Application payment:** a box price, mint price, or other application charge.
- **Application assets:** NFTs, materials, or reward inventory controlled by the application.

A protocol refund does not automatically refund a sale payment or return application assets.

### Required recovery matrix

| Situation | Protocol state | Generated application behavior |
| --- | --- | --- |
| Request transaction reverts | No new RNG request escrow is created; transaction gas may be spent | Same-transaction effects revert. Reconcile any earlier separate payment or asset reservation according to the application policy. |
| Request is pending | No final accepted result yet | Keep its committed inputs fixed; show a waiting state and preserve its action identity. |
| Deadline passes without accepted proof | Refund can be requested using the request's snapshotted refund ratio and fixed recipient | Execute or expose the protocol refund path and separately apply the selected application-payment or asset-return policy. |
| Proof is accepted, callback fails | The accepted word is final; the service fee is earned | Retry delivery of the same result with appropriate gas. Do not request a replacement result because delivery failed. |
| Callback succeeds, application mint or payout fails | Randomness has already been delivered | Retry or claim the same application outcome idempotently; preserve the assets needed to fulfill it. |
| Refund transfer fails and backed credit is recorded | Refund value is accounted for as recipient credit | Show the credit and expose the appropriate withdrawal path for its recipient. |
| Refund payment or credit is settled, notification fails | Financial refund is already settled | Retry notification only. Never pay the refund twice. |
| Request was overpaid | Excess may become the fixed refund recipient's credit | Track and expose withdrawal; do not classify it as application revenue. |

At the planning baseline, the protocol refund ratio is snapshotted when requesting, defaults to 100%, and can be configured within the protocol's allowed range for future requests. Studio cannot choose a different live coordinator refund ratio for one consumer. Any stronger application refund promise must be separately funded and implemented.

Refunds require transactions. Gas costs and application fees are not automatically covered by the protocol refund.

The generated agent instructions should explain the relevant calls, including `retryCallback`, `refundRequest`, `withdrawRefundCredit`, and `retryRefundCallback`, using the selected SDK's exact interfaces.

## 14. Compatibility and validation rules

Examples of checks Studio should enforce:

- Premint and reserved allocation fit within maximum supply.
- Reveal explicitly includes or excludes premints and fixes its participating token set.
- Metadata commitments, item order, weights, rules, and algorithm version cannot change for an already committed action.
- Built-in mapping bounds match the chosen SDK; the baseline population cap for choice and shuffle operations is 256.
- Weighted probabilities use explicit integer weights and a nonzero total; percentages are derived for display.
- Independent weighted draws are not described as fixed-stock distribution or guaranteed rarity counts.
- Duplicate restrictions and finite-stock choices have an implemented allocation strategy.
- Existing contracts expose the required mint, metadata, or controller hooks and permissions.
- Royalty configuration has valid units and receiver requirements and does not imply universal payment enforcement.
- Refundable application funds or assets remain available until the relevant liabilities are resolved.
- Owner withdrawals cannot consume funds reserved for outstanding claims or refunds.
- Administration changes do not rewrite the inputs of pending or completed actions.
- An accepted random word cannot be discarded in favor of a more desirable result.
- Public seeds are not used to claim secrecy for future hidden outcomes.
- Callback work fits a measured gas budget; large minting or metadata operations are not placed blindly in the callback.

Unsupported choices should explain what is missing and which supported alternative is available. The generator should never ask an agent to invent nonexistent SDK methods.

## 15. Verification and generated tests

Generate meaningful behavioral checks for the chosen template and features, such as:

- Unauthorized mint, reveal, configuration change, or withdrawal attempts.
- Maximum supply, premint allocation, and mint-limit behavior.
- Royalty calculation and receiver behavior when enabled.
- Invalid or zero-total loot weights and boundary values in reward selection.
- Correct request-to-action association when callbacks arrive out of order.
- Duplicate callback, claim, or finalization attempts.
- Input freeze after a request is committed.
- Underpayment and overpayment handling.
- Accepted proof followed by callback failure and same-result retry.
- Expiry, protocol refund, application recovery, and refund-credit handling.
- Refund notification failure without duplicate payment.
- Metadata assignment reproducibility and the selected mapping's bounds.

The current generator's consumers are compiled in the test suite, and the browser exposes real compilation. The full generated-application behavioral suite listed above remains future work; compilation alone is not runtime contract validation.

Local simulations, local contract tests, testnet transactions, and mainnet transactions must remain distinct in reports and UI.

## 16. Interface direction

Recommended workspace areas:

- **Projects:** local project list and import/export.
- **Mechanic:** guided setup for the selected use case.
- **Assets:** item and metadata editor with previews.
- **Features:** expandable modules and their dependencies.
- **Behavior:** payments, delivery, expiry, and recovery policies.
- **Preview:** simulation and an understandable project summary.
- **Export:** code, project JSON, documentation, and agent prompt.

Prioritize clear forms, visible validation, persistent drafts, and explanations of consequential choices. Technical details should appear where they help a developer make a decision, rather than overwhelming the initial onboarding.

The current skeleton uses the approved black/white/coral theme, React and TypeScript on Vite, shared native interface primitives, and browser-local persistence. Further visual refinements should follow the approved concepts.

## 17. Local data and credential boundaries

The proposed initial Studio is a configuration and generation tool. It does not need private keys, wallet recovery phrases, operator secrets, or access to a keeper database.

- Use public contract addresses, deployment references, and metadata inputs.
- Do not request or export private signing material.
- Keep asset previews and project persistence local unless the user explicitly chooses a future upload or synchronization feature.
- Explain what an exported file contains.
- Treat imported project files and metadata as untrusted data and validate their schema and size.

If deployment or hosted services are added later, they require a separately designed product flow. This document does not configure hosting or authorize deployment.

## 18. Proposed delivery phases

### Phase 1: A complete loot workflow

- Local project creation and reopening.
- Lootbox onboarding.
- Item and metadata editor.
- Integer weight configuration and probability summary.
- One clearly defined reward-selection model.
- Clearly labeled simulation.
- Reviewed consumer and client boilerplate.
- D20DAO lifecycle and recovery documentation.
- JSON, ZIP, and agent-prompt export.
- Relevant generated checks and truthful output status.

Use one narrowly supported asset/contract path first. Add compatible collection options, including premint and royalties, when the selected template implements their interactions correctly.

### Phase 2: NFT reveal

- Collection and token-set setup.
- Premint/reveal interaction.
- Metadata commitment and reveal rules.
- Supported-size assignment workflow.
- Reveal controller starter and verification output.
- A compatible existing-collection integration path.

### Phase 3: Validated extensions

- Additional token standards and mint features.
- Finite-stock packs and advanced allocation models.
- Crafting and evolution.
- Larger-collection reveal after separate design and review.
- More client or game-engine adapters when requested by real teams.
- Optional sharing, synchronization, or hosted project features.

### Adoption showcase

Work with one game team on loot and one NFT team on reveal. Turn the working integrations into reusable examples and, when useful, a small expedition showcase using partner assets.

New chain releases should follow actual consumer needs and technical readiness. Studio configuration, API payment origin, and the chain that executes a D20DAO request are separate concerns.

## 19. Success criteria

Measure:

- Projects that reach a valid configuration.
- Exports that lead to a first successful integration.
- Independent teams deploying and using their own consumers.
- Time and support effort required to reach a first accepted result and successful application delivery.
- Integrations still used after 30 days.
- Teams returning to create another mechanic or project.
- Partner result pages and demonstrations that lead to new developer enquiries.

Track demo players, simulations, and D20DAO-operated requests separately from external adoption.

## 20. Open implementation decisions

- First supported reward asset and NFT standard.
- Exact boundary between new-contract and existing-contract generation.
- Initial set of optional modules and supported combinations.
- Asset-size limits and migration from the current bounded localStorage drafts if larger asset bundles are introduced.
- Metadata input/import format and export hosting instructions.
- Extending the current template and dependency locks to complete NFT feature combinations.
- Where the future generated-application behavioral tests run; browser compilation and local generator/compiler tests are already implemented.
- Revenue model, if any; no Studio pricing has been selected.
- Timing of public hosting and domain configuration.

Resolve these decisions as they become relevant to implementation. An implementation agent should document reasonable assumptions, explain consequential tradeoffs, and seek clarification when a choice materially changes the agreed scope. Routine implementation choices should not block progress.

## 21. Reference material

### D20DAO

- [SDK source](https://github.com/d20dao/d20-sdk)
- [SDK package](https://www.npmjs.com/package/@d20dao/vrf-sdk)
- [SDK agent guide](https://github.com/d20dao/d20-sdk/blob/main/AGENTS.md)
- [SDK API reference](https://github.com/d20dao/d20-sdk/blob/main/API.md)
- [Protocol provenance](https://github.com/d20dao/d20-sdk/blob/main/PROTOCOL-PROVENANCE.json)
- [Public protocol snapshot](https://github.com/d20dao/d20-sdk/tree/main/protocol)
- [SDK examples](https://github.com/d20dao/d20-sdk/tree/main/examples)
- [Loot-drop consumer example](https://github.com/d20dao/d20-sdk/blob/main/examples/LootDropConsumer.sol)
- [Randomizer demo](https://github.com/d20dao/randomizer-demo)
- [Agent integration skills](https://github.com/d20dao/skills)
- [Developer documentation](https://d20dao.org/docs)
- [Documentation index](https://d20dao.org/llms.txt)
- [Arc Mainnet deployment manifest](https://d20dao.org/deployments/arc-mainnet.json)
- [Arc Testnet deployment manifest](https://d20dao.org/deployments/arc-testnet.json)

The links above are discovery references. Generated projects must also record the exact reviewed package, template, and deployment versions; moving `main` links are not version pins.

### Standards and implementation guidance

- [ERC-2981: NFT Royalty Standard](https://eips.ethereum.org/EIPS/eip-2981)
- [OpenZeppelin ERC-2981 documentation](https://docs.openzeppelin.com/contracts/5.x/api/token/common)
- [OpenZeppelin ERC-721 and royalty extensions](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721)

### Related local workspaces

The planning discussion drew on the existing `d20-sdk`, `d20-keeper`, `d20dao-web`, `d20-skills`, `d20dao-agent-api`, `d20dao-mcp`, `randomizer-demo`, and Lottewy workspaces. They provide implementation references and examples; this specification does not modify them.
