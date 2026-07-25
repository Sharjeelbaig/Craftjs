import type { BlockId } from '@domain/world/BlockType';

export interface PlayerPresence {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly moving: boolean;
}

export interface BlockEditMessage {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

/**
 * Optional realtime boundary. The game remains fully functional when this port
 * is absent or disconnected; networking is an enhancement, never a dependency
 * of the domain model or fixed-step loop.
 */
export interface MultiplayerSession {
  readonly room: string;
  readonly connected: boolean;

  connect(): void;
  publishPresence(presence: Omit<PlayerPresence, 'id'>): void;
  publishBlockEdit(edit: BlockEditMessage): void;
  peers(): readonly PlayerPresence[];
  onBlockEdit(listener: (edit: BlockEditMessage) => void): () => void;
  onStatus(listener: (message: string) => void): () => void;
  dispose(): void;
}
