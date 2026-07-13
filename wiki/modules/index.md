---
title: Package barrel (src/index.ts)
description: The public export surface — everything re-exported from one entry point.
tags:
  - wiki
  - module
---
## Purpose

Single import surface for the whole package; mirrors `openviking/integrations/langchain/__init__.py`.

## Responsibilities

Re-export every public type/class/function from the other modules — nothing else. See [Layered design](../architecture/layered-design.md) for how the re-exported pieces relate to each other.

## Public API / entry points

Everything listed in the [README.md Exports table](../../README.md).

## Key files

[src/index.ts](../../src/index.ts)

## Dependencies

Every other module in `src/`.

## Flows it participates in

n/a — pure re-export.
