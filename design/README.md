# Studio interface concepts

Nine desktop interface concepts for `studio.d20dao.org`, prepared by the requested **GPT-6 Astra agent at medium reasoning effort** using the built-in **ImageGen** tool.

These are raster design studies. They do not implement an application, generate usable contracts, perform compilation, or demonstrate live D20DAO transactions. Any project names, item configurations, file contents, and controls in the images are illustrative design content.

## Review

Open [the local gallery](index.html) or select an image below. The gallery displays the original generated images without changing them.

| Screen | Design focus |
| --- | --- |
| [01 — Projects](concepts/01-projects.png) | A compact list of local projects, import, and project creation. |
| [02 — New project](concepts/02-new-project.png) | Mechanic selection and new-project versus existing-project context. |
| [03 — Lootbox](concepts/03-lootbox.png) | Assets, metadata, weights, derived probabilities, and optional modules. |
| [04 — NFT reveal](concepts/04-nft-reveal.png) | Token set, metadata, premint, royalty, and reveal configuration. |
| [05 — Files and compile](concepts/05-files-compile.png) | File tree, source preview, compiler controls, and initial output panels. |
| [06 — Agent and export](concepts/06-agent-export.png) | Project-specific agent instructions and downloadable project artifacts. |
| [07 — Payment and recovery](concepts/07-payment-recovery.png) | Application price, RNG payer, refund recipient, and recovery responsibility. |
| [08 — Optional modules](concepts/08-optional-modules.png) | Expandable premint and royalty configuration with generated-output implications. |
| [09 — Project overview](concepts/09-project-overview.png) | Project identity, integration context, target network, and configuration summary. |

## Brand reference

The visual direction follows the actual public D20DAO website and its developer documentation, inspected on September 22, 2026:

- Pure black background with white typography.
- Pink/coral primary action color, restrained yellow accents, and thin neutral rules.
- Arial/Helvetica-style sans-serif content and Courier-style monospace navigation and labels.
- Compact angular D20DAO brand lockup with a Studio product suffix.
- Restrained corners and flat, functional work areas.
- The documentation layout supplies the working-surface reference; the homepage's large die and particle effects are not carried into the editor.

References captured from the public website:

- [D20DAO homepage](references/d20dao-home.png), from <https://d20dao.org/>.
- [D20DAO integration documentation](references/d20dao-docs.png), from <https://d20dao.org/docs/integration>.

The local `d20dao-web` CSS and brand-mark source were also inspected as read-only references. Existing application and protocol files were not modified.

## Scope represented

The concepts reflect a developer-first template configurator with a file browser and agent handoff. Existing-project integration means exporting boilerplate plus project-specific instructions for an agent to adapt. It does not mean modifying an arbitrary repository from the Studio browser.

Browser compilation is represented as a desired interface capability with an initial, uncompiled state. The concepts do not claim that a compiler has been implemented or that the illustrated code has passed compilation.

Claim and finalization are not mandatory Studio onboarding steps. Application-specific delivery and recovery behavior belongs in the generated instructions. Protocol fee refunds remain distinct from application payments and asset returns.

## Generation provenance

See [the complete prompts and generation record](concepts/PROMPTS.md). Each requested screen is generated separately with a common brand brief and reference imagery. All final concepts are saved in this project's `design/concepts/` directory.

ImageGen text and code in raster mockups are visual approximations. Final implementation should use verified product copy, accessible controls, real source files, and the pinned SDK interfaces.

## Details to resolve in implementation

- The Lootbox concept depicts chance values in bordered cells. These should be derived, read-only values when weights are the editable source of truth.
- The Reveal concept's shortened royalty address is illustrative. Actual address entry must accept and validate a complete address.
- Compiler controls and code shown in the concepts describe the intended interface, not a tested compiler integration or reviewed contract implementation.
