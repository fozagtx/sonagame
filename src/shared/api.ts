import type { RingBlueprint } from './tower';

export type LeaderboardEntry = {
  username: string;
  depth: number;
  mode: 'daily' | 'endless';
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  dateKey: string;
  dailySeed: number;
  personalBest: number;
  dailyBest: number;
  streak: number;
  todayPlayed: boolean;
  leaderboard: LeaderboardEntry[];
  communityBlueprints: RingBlueprint[];
  playersToday: number;
};

export type SubmitScoreRequest = {
  depth: number;
  mode: 'daily' | 'endless';
  dateKey: string;
};

export type SubmitScoreResponse = {
  type: 'score';
  personalBest: number;
  dailyBest: number;
  streak: number;
  isNewPersonalBest: boolean;
  isNewDailyBest: boolean;
  rank: number | null;
  leaderboard: LeaderboardEntry[];
};

export type SubmitBlueprintRequest = {
  segments: RingBlueprint['segments'];
  name?: string;
};

export type SubmitBlueprintResponse = {
  type: 'blueprint';
  id: string;
  message: string;
};

export type BlueprintListResponse = {
  type: 'blueprints';
  blueprints: Array<{
    id: string;
    username: string;
    name: string;
    segments: RingBlueprint['segments'];
    votes: number;
  }>;
};

export type VoteBlueprintRequest = {
  id: string;
};

export type VoteBlueprintResponse = {
  type: 'vote';
  id: string;
  votes: number;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
