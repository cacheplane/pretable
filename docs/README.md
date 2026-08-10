# Pretable documentation

This directory preserves product decisions, execution recipes, research, and
handoffs. It is an archive with explicit authority rules, not the current
roadmap.

## Authority

1. Package changelogs and generated API reports describe shipped behavior.
2. [ROADMAP.md](../ROADMAP.md) describes current prioritization.
3. docs/superpowers/specs/ contains approved design and decision records.
4. docs/superpowers/plans/ contains execution recipes, not live status.
5. status/milestones/ contains committed performance evidence.
6. docs/research/ and handoffs are historical unless a current document links
   to them explicitly.

When documents disagree, use the highest applicable source above. Public
consumer documentation must describe released behavior and should not advertise
speculative roadmap APIs.

## Lifecycle

New design specs use `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
Implementation plans use `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.

Every new spec should include:

- Date
- Status: draft, approved, planned, in-progress, shipped, or superseded
- Supersedes / Superseded by when applicable
- implementation plan, PR/commit, and released version when those exist

Status meanings:

- draft: under discussion
- approved: design accepted; no implementation plan is implied
- planned: an implementation plan exists
- in-progress: implementation is active
- shipped: released behavior exists; changelogs/API reports remain authoritative
- superseded: retained for history and linked to its replacement

Unchecked boxes in an old plan do not prove work remains. Confirm shipped state
from changelogs, API reports, and implementation history.

## Repository map

- superpowers/specs/: dated designs and decision records
- superpowers/plans/: dated implementation recipes
- research/: diagnostics, closeouts, and historical memory
- handoffs/ and superpowers/handoffs/: point-in-time transfer notes
- ../status/milestones/: committed benchmark evidence

## Maintenance

- Keep ROADMAP.md short and outcome-oriented.
- Mark superseded documents; do not delete decision history.
- Link corrections to the evidence they replace.
- Update public documentation, API reports, and changelogs with shipped APIs.
- Review roadmap claims against committed evidence before publishing them.
