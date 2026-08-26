import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_PERFORMANCE_ENTRY_NAMES,
  markAppBackgroundRefreshComplete,
  markAppDataReady,
  markAppSurfaceReady,
  resetAppPerformanceForTests,
  startAppNavigation,
  startDocumentNavigation,
} from './appPerformance';

describe('appPerformance', () => {
  afterEach(() => resetAppPerformanceForTests());

  it('measures an internal navigation from the action to surface and data readiness', () => {
    startAppNavigation('home', 'game-setup');
    markAppSurfaceReady('game-setup');
    markAppDataReady('cloud-decks', 'cache-fresh', { count: 1 });

    const surfaceMeasures = performance.getEntriesByName(
      APP_PERFORMANCE_ENTRY_NAMES.navigationToSurface,
      'measure'
    ) as PerformanceMeasure[];
    const dataMeasures = performance.getEntriesByName(
      APP_PERFORMANCE_ENTRY_NAMES.navigationToData,
      'measure'
    ) as PerformanceMeasure[];

    expect(surfaceMeasures).toHaveLength(1);
    expect(surfaceMeasures[0].detail).toMatchObject({
      surface: 'game-setup',
      requestedTarget: 'game-setup',
    });
    expect(dataMeasures).toHaveLength(1);
    expect(dataMeasures[0].detail).toMatchObject({
      source: 'cloud-decks',
      mode: 'cache-fresh',
      count: 1,
    });
  });

  it('accepts the first committed surface as the target of a document load', () => {
    startDocumentNavigation('/?page=game-setup');
    markAppSurfaceReady('game-setup');

    const measures = performance.getEntriesByName(
      APP_PERFORMANCE_ENTRY_NAMES.navigationToSurface,
      'measure'
    ) as PerformanceMeasure[];
    expect(measures).toHaveLength(1);
    expect(measures[0].detail).toMatchObject({
      surface: 'game-setup',
      trigger: 'document-load',
    });
  });

  it('records background refresh outcome without creating duplicate readiness measures', () => {
    startAppNavigation('game-setup', 'home');
    markAppDataReady('cloud-decks', 'cache-stale');
    markAppDataReady('cloud-decks', 'background');
    markAppBackgroundRefreshComplete('cloud-decks', 'success', { count: 2 });

    expect(
      performance.getEntriesByName(APP_PERFORMANCE_ENTRY_NAMES.navigationToData, 'measure')
    ).toHaveLength(1);
    const completion = performance.getEntriesByName(
      APP_PERFORMANCE_ENTRY_NAMES.backgroundRefreshComplete,
      'mark'
    ) as PerformanceMark[];
    expect(completion).toHaveLength(1);
    expect(completion[0].detail).toMatchObject({ outcome: 'success', count: 2 });
  });
});
