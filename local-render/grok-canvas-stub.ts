export {
  useState,
  useEffect,
  useMemo,
} from "react";
export type {
  ChangeEvent,
  KeyboardEvent,
  CSSProperties,
  ReactNode,
} from "react";

export function useGrokTheme() {
  return {
    font: {
      mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  };
}
