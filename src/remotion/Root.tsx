import React from 'react';
import { Composition } from 'remotion';
import { VideoComposition, type VideoCompositionProps } from '../engine/VideoComposition';
import { VideoSchema } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import demo from './demo-spec.json';
import '../scenes';

const defaultSpec = VideoSchema.parse(demo);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={VideoComposition as unknown as React.FC<Record<string, unknown>>}
      defaultProps={{ spec: defaultSpec, assetBase: '', mode: 'preview' } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as VideoCompositionProps;
        // Props arriving from the CLI are re-validated at runtime (never trust external JSON).
        const spec = VideoSchema.parse(p.spec);
        const tl = buildTimeline(spec.scenes, spec.canvas.fps);
        return {
          durationInFrames: Math.max(1, tl.totalFrames),
          fps: spec.canvas.fps,
          width: spec.canvas.width,
          height: spec.canvas.height,
          props: { ...p, spec } as unknown as Record<string, unknown>,
        };
      }}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
    />
  );
};
