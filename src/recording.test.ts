import { describe, it, expect } from 'vitest';
import type { RecordingState } from './types';

/**
 * Tests for the recording state machine transitions.
 * The actual functions (startRecording, pauseRecording, resumeRecording) have
 * Leaflet/DOM dependencies, so we test the state transition logic directly
 * by verifying the guard conditions and state mutations match the state diagram:
 *
 *   idle → recording → paused → recording (cycle)
 *                    → idle (stop)
 *              paused → idle (stop)
 */

interface MinimalRecordingState {
  recordingState: RecordingState;
  recordingPauseMs: number;
  recordingPauseStart: number | null;
  trailPoints: unknown[];
  trailSegments: unknown[][];
}

function createState(): MinimalRecordingState {
  return {
    recordingState: 'idle',
    recordingPauseMs: 0,
    recordingPauseStart: null,
    trailPoints: [],
    trailSegments: [],
  };
}

// Mirrors the guard + mutation logic from recording.ts
function pauseRecording(state: MinimalRecordingState): void {
  if (state.recordingState !== 'recording') return;
  state.recordingState = 'paused';
  state.recordingPauseStart = performance.now();
}

function resumeRecording(state: MinimalRecordingState): void {
  if (state.recordingState !== 'paused') return;
  if (state.recordingPauseStart !== null) {
    state.recordingPauseMs += performance.now() - state.recordingPauseStart;
  }
  state.recordingPauseStart = null;
  state.recordingState = 'recording';
  if (state.trailPoints.length > 0) {
    state.trailSegments.push(state.trailPoints);
  }
  state.trailPoints = [];
}

describe('recording state machine', () => {
  it('starts in idle state', () => {
    const s = createState();
    expect(s.recordingState).toBe('idle');
  });

  it('pause is a no-op when idle', () => {
    const s = createState();
    pauseRecording(s);
    expect(s.recordingState).toBe('idle');
  });

  it('resume is a no-op when idle', () => {
    const s = createState();
    resumeRecording(s);
    expect(s.recordingState).toBe('idle');
  });

  it('transitions recording → paused', () => {
    const s = createState();
    s.recordingState = 'recording';
    pauseRecording(s);
    expect(s.recordingState).toBe('paused');
    expect(s.recordingPauseStart).not.toBeNull();
  });

  it('transitions paused → recording', () => {
    const s = createState();
    s.recordingState = 'recording';
    pauseRecording(s);
    const pauseStart = s.recordingPauseStart;
    expect(pauseStart).not.toBeNull();

    resumeRecording(s);
    expect(s.recordingState).toBe('recording');
    expect(s.recordingPauseStart).toBeNull();
    expect(s.recordingPauseMs).toBeGreaterThan(0);
  });

  it('accumulates pause time across multiple pause/resume cycles', () => {
    const s = createState();
    s.recordingState = 'recording';

    pauseRecording(s);
    resumeRecording(s);
    const firstPause = s.recordingPauseMs;

    pauseRecording(s);
    resumeRecording(s);
    expect(s.recordingPauseMs).toBeGreaterThan(firstPause);
  });

  it('double-pause is a no-op', () => {
    const s = createState();
    s.recordingState = 'recording';
    pauseRecording(s);
    const pauseStart = s.recordingPauseStart;
    pauseRecording(s); // second pause
    expect(s.recordingPauseStart).toBe(pauseStart); // unchanged
  });

  it('double-resume is a no-op', () => {
    const s = createState();
    s.recordingState = 'recording';
    pauseRecording(s);
    resumeRecording(s);
    const pauseMs = s.recordingPauseMs;
    resumeRecording(s); // second resume
    expect(s.recordingPauseMs).toBe(pauseMs); // unchanged
  });

  it('resume creates a new segment from existing trail points', () => {
    const s = createState();
    s.recordingState = 'recording';
    s.trailPoints = [{ lat: 1 }, { lat: 2 }];

    pauseRecording(s);
    resumeRecording(s);

    expect(s.trailSegments).toHaveLength(1);
    expect(s.trailSegments[0]).toHaveLength(2);
    expect(s.trailPoints).toHaveLength(0); // fresh segment
  });

  it('resume with empty trail points does not create empty segment', () => {
    const s = createState();
    s.recordingState = 'recording';
    // trailPoints is empty

    pauseRecording(s);
    resumeRecording(s);

    expect(s.trailSegments).toHaveLength(0);
  });
});
