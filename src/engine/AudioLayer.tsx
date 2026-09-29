/** Voice, music (fades + smooth ducking) and planned SFX. */
import React, { useMemo } from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import { useVideo, resolveAssetUrl } from './context';
import { musicVolumeAt, planSfx } from '../audio/mix';
import { SceneRegistry } from '../scenes/registry';

export function sfxUrl(file: string, assetBase: string): string {
  // Library sounds live in public/sfx; overrides are project assets.
  return file.startsWith('sfx/') ? staticFile(file) : resolveAssetUrl(file, assetBase);
}

export function AudioLayer({ fps }: { fps: number }) {
  const v = useVideo();
  const { spec, timeline } = v;
  const sfx = useMemo(() => planSfx(spec, timeline, (s) => SceneRegistry.get(s.type)?.manifest.sfx ?? []), [spec, timeline]);
  const voice = spec.audio.mode !== 'none' ? spec.audio.voice : undefined;
  const music = spec.audio.music;
  const total = timeline.totalSec;
  // audio sources may be asset ids or project-relative paths
  const url = (src: string) => resolveAssetUrl(spec.assets[src]?.src ?? src, v.assetBase);
  return (
    <>
      {voice ? (
        <Sequence from={Math.round(voice.offset * fps)} name="voice">
          <Audio src={url(voice.src)} volume={voice.volume} />
        </Sequence>
      ) : null}
      {music ? (
        <Audio
          src={url(music.src)}
          loop={music.loop}
          trimBefore={music.trimStart > 0 ? Math.round(music.trimStart * fps) : undefined}
          trimAfter={music.trimEnd ? Math.round(music.trimEnd * fps) : undefined}
          volume={(f) => musicVolumeAt(f / fps, spec, total)}
          name="music"
        />
      ) : null}
      {sfx.map((c, i) => (
        <Sequence key={i} from={Math.max(0, Math.round(c.atSec * fps))} durationInFrames={Math.max(1, Math.ceil((c.duration + 0.1) * fps))} name={`sfx ${c.sound}`}>
          <Audio src={sfxUrl(c.file, v.assetBase)} volume={Math.min(1, c.volume)} />
        </Sequence>
      ))}
    </>
  );
}
