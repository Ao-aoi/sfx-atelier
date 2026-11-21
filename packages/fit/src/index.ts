export { decayOf, energyOf, FLOOR, lineFit, windowGain } from "./components";
export type { Component, NoiseComponent, OscComponent } from "./components";
export { applyBudget, buildScore, DEFAULT_BUDGET, fit, jsonBytes, sig, toLayer } from "./fit";
export type { Budget, FitOptions, FitResult } from "./fit";
export { BAND_EDGES, bandPower, fitNoise, WHITE_RMS } from "./noise";
export { findAttacks, findOnsets, mergeOnsets } from "./onsets";
export { assignOnset, fitTrack, tonalOnsets, trackStart } from "./tonal";
export { findTracks, framePeaks } from "./tracks";
export type { Peak, Track, TrackOptions } from "./tracks";
