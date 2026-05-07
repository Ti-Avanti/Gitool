/// <reference types="vite/client" />

import type { GitoolApi } from "./shared/types";

declare global {
  interface Window {
    gitool: GitoolApi;
  }
}
