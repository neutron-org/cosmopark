export interface Relayer {
  start(): Promise<void>;
  pause(): Promise<void>;
  unpause(): Promise<void>;
  type(): string;
}
