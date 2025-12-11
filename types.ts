export interface Lesson {
  id: string;
  timestamp: string;
  topic: string;
  summary: string;
  averageScore: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface ClarityUpdate {
  score: number;
  reasoning: string;
  language?: string;
}