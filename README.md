# Evo Plants Sim 3D

Realtime browser-based simulation of procedural terrain, hydrology, erosion, seasonal climate, and evolving plant ecology. The project combines a fixed-step TypeScript simulation core with Babylon.js rendering to make environmental systems visible and interactive in 3D.

## Project Summary

Evo Plants Sim 3D is an interactive ecosystem sandbox. It generates a terrain heightfield, simulates rainfall and downhill water movement, models erosion and soil moisture, and grows plant populations that respond to local habitat pressure, climate, seasonality, and terrain stability.

The application is designed as a portfolio-ready engineering project rather than a static visual demo: simulation logic, rendering, UI controls, utilities, and configuration are split into separate modules with clear responsibilities.

## Technical Highlights

- Procedural terrain generation using layered noise, ridges, basins, soil depth, bedrock, and coarse rock fields.
- Fixed-step simulation scheduler for stable hydrology, erosion, ecology, vegetation, and slower world processes.
- Surface-water solver that routes flow using combined terrain height and water depth, allowing lakes, overflow, and river accumulation to emerge.
- Moisture, flood-prone, temperature, seasonal, and regional climate fields that influence plant suitability and stress.
- Plant ecology model with species lineages, mutation, spread, establishment, biomass budgets, dormancy, mortality, and diagnostic overlays.
- Interactive terrain sandbox tools for rock placement, uplift, lowering, flattening, roughening, water source creation, and source removal.
- Babylon.js 3D renderer with separate terrain, water, and vegetation rendering layers.
- Framework-free DOM control panel with typed callbacks between UI and simulation state.

## Tech Stack

- TypeScript
- Vite
- Babylon.js
- HTML and CSS
- npm

## Architecture

```text
src/
  app.ts                 Application orchestration, render loop, input handling
  main.ts                Browser entry point
  scene/                 Babylon.js scene, terrain mesh, water overlay, plant renderer
  sim/                   Terrain, hydrology, erosion, climate, season, vegetation models
  ui/                    DOM control bindings and diagnostics panel updates
  utils/                 Math, noise, and deterministic random helpers
```

Key boundaries:

- `src/sim/` owns simulation state and deterministic model updates.
- `src/scene/` converts simulation buffers into visible Babylon.js meshes and materials.
- `src/ui/` owns DOM reads/writes and exposes typed callbacks to the app layer.
- `src/app.ts` coordinates systems without embedding model-specific algorithms.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the app:

```text
http://localhost:5173
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Controls

- `Pause` / `Start`: Toggle simulation updates.
- `Reset`: Reset water, erosion, moisture, vegetation, and season state for the current terrain.
- `Regenerate`: Create a new terrain seed and rebuild the world.
- `Plant`: Seed vegetation immediately.
- `Rain Intensity`: Control rainfall input.
- `Simulation Speed`: Scale simulated time.
- Sandbox tools: View, Add Rock, Uplift, Lower, Flatten, Roughen, Water Source, Erase Source.
- Overlays: Rivers, water depth, moisture, temperature, season, vegetation, climate fields, and plant diagnostics.
- Plant inspection: In View mode, click an occupied plant cell to inspect lineage, habitat, stress, budget, and history diagnostics.

## Resume Bullets

- Built a realtime 3D ecological simulation in TypeScript using Babylon.js and Vite, with modular separation between simulation, rendering, UI, and utilities.
- Implemented fixed-step hydrology, erosion, climate, moisture, and vegetation systems over a 128x128 procedural terrain grid.
- Designed plant lineage and habitat diagnostics that expose stress, suitability, reproduction, dormancy, and mortality drivers through interactive overlays.
- Added sandbox editing tools that let users modify terrain and water sources while preserving simulation consistency across hydrology and erosion systems.

## Repository Hygiene

Generated and local-only files are intentionally ignored:

- `node_modules/`
- `dist/`
- TypeScript build info
- environment files
- logs
- editor and OS metadata
- test and coverage output

The committed source should remain focused on application code, configuration, lockfiles, and documentation.
