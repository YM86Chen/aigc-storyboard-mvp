export interface SingleFlight {
  tryStart(): boolean;
  finish(): void;
  isActive(): boolean;
}

export function createSingleFlight(): SingleFlight {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
    isActive() {
      return active;
    },
  };
}
