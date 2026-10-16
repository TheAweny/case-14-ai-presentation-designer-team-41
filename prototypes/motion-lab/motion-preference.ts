import { createContext, useContext } from 'react';
import { useReducedMotion } from 'motion/react';

export const LabMotionContext = createContext(false);
export function useLabReducedMotion(): boolean {
  const system = useReducedMotion();
  const lab = useContext(LabMotionContext);
  return lab || system === true;
}
