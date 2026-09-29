import { useContext } from 'react';
import { SceneCtx, useVideo } from '../engine/context';

export { useVideo };
/** Scene context if inside a scene (Text can also be used in overlays). */
export function useContextScene() {
  return useContext(SceneCtx);
}
