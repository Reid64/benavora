# Benavora Enterprise Agentic Prospect Intelligence Layer

## Release 01 — Constitutional Foundation and Reference Agent

This package is the first dependency-ordered release of the isolated Prospect Intelligence Layer (PIL). It is designed for later integration into Benavora or licensing as an independent multi-tenant intelligence subsystem.

The governing rule is functional, not rhetorical: a component is an agent only when it durably owns or receives a goal, observes state, constructs and revises a plan, chooses authorized tools or delegates through typed contracts, evaluates evidence and outcomes, and continues, stops, pauses, escalates, or replans. Crawlers, parsers, schedulers, data stores, policy engines, adapters, and validators are deterministic services.

## Release contents

| File | Purpose |
|---|---|
| `00-governance/00-system-constitution.md` | Binding architectural and behavioral laws |
| `01-registries/01-agent-registry.yaml` | Canonical 44-agent fleet registry |
| `01-registries/02-service-registry.yaml` | Canonical deterministic support-service registry |
| `02-contracts/03-shared-agent-contracts.yaml` | Versioned goal, task, run, evidence, decision, and event contracts |
| `03-chain-it/04-chain-it-master-manifest.yaml` | Dependency gates and nonstop Claude Code execution protocol |
| `04-agents/supervisory/BEN-SUP-01-chief-prospect-intelligence-orchestrator.md` | First complete reference agent build specification |
| `05-evaluation/05-enterprise-agent-scorecard.md` | Evidence-based 100-point quality and production gate |
| `RELEASE-MANIFEST.yaml` | Checksums, status, scope, and future release ordering |

## Required execution order

1. Read every file in this release.
2. Treat the constitution and shared contracts as binding.
3. Implement deterministic foundations before agent runtime behavior.
4. Implement BEN-SUP-01 only after its dependencies are present.
5. Run all specified tests and evaluations.
6. Do not claim completion while any blocking gate is failing.

## Truthful status

This release specifies the foundation and BEN-SUP-01. It does not claim that the other 43 agents or all deterministic services have already been implemented. The registries reserve their canonical identities and define the dependency-ordered program that follows.

