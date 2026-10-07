# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**JSG HubDev Manager** (`JeffersonGoncalves.jsg-hubdev-manager`) is a VS Code extension (TypeScript) for HubDev: it finds the open project in HubDev's central `~/.devhub/config/sites.yml` and runs `hubdev site:*` commands (link, unlink, start, stop, secure). It is the VS Code port of `../hubdev-manager-plugin` (JetBrains) and mirrors its behaviour.

## Commands

```bash
pnpm install
pnpm run compile   # esbuild -> dist/extension.js (bundles the `yaml` dependency)
pnpm test          # tsc -> out/, then node --test (pure core only, no VS Code host)
pnpm run lint
pnpm dlx @vscode/vsce package --no-dependencies
```

pnpm 11: build-script approval lives in `pnpm-workspace.yaml` (`allowBuilds`), never in `package.json`.

## Architecture

| File | Purpose |
|------|---------|
| `src/core/hubdev.ts` | `sites.yml` parsing (`yaml`), path matching, default names, executable detection (`devhub.exe` / `hubdev` / `devhub`). No `vscode` import; `Env` is injectable — unit tested |
| `src/extension.ts` | Commands, HubDev tree view, status bar item, watcher on `~/.devhub/config/sites.yml`, CLI runner (`exec` for `.bat`/`.cmd`, `execFile` otherwise) |

## Release

Bump `version` in `package.json`, publish a GitHub release: `.github/workflows/release.yml` packages the `.vsix`, attaches it to the release and publishes to the Marketplace when the `VSCE_PAT` secret exists. The CHANGELOG is updated by `update-changelog.yml` — don't edit it by hand.
