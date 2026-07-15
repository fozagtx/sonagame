import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  BlueprintListResponse,
  ErrorResponse,
  InitResponse,
  LeaderboardEntry,
  SubmitBlueprintRequest,
  SubmitBlueprintResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
  VoteBlueprintRequest,
  VoteBlueprintResponse,
} from '../../shared/api';
import {
  dailySeed,
  isValidBlueprint,
  type RingBlueprint,
  utcDateKey,
} from '../../shared/tower';

export const api = new Hono();

const MAX_LEADERBOARD = 10;
const MAX_BLUEPRINTS = 24;

function userKey(username: string): string {
  return `user:${username}`;
}

function dailyLbKey(dateKey: string): string {
  return `lb:daily:${dateKey}`;
}

function blueprintsKey(): string {
  return 'blueprints:v1';
}

async function getUsername(): Promise<string> {
  const username = await reddit.getCurrentUsername();
  return username ?? 'anonymous';
}

async function loadLeaderboard(dateKey: string): Promise<LeaderboardEntry[]> {
  const raw = await redis.get(dailyLbKey(dateKey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_LEADERBOARD) : [];
  } catch {
    return [];
  }
}

async function saveLeaderboard(
  dateKey: string,
  entries: LeaderboardEntry[]
): Promise<void> {
  await redis.set(dailyLbKey(dateKey), JSON.stringify(entries.slice(0, MAX_LEADERBOARD)));
}

async function loadBlueprints(): Promise<
  Array<{
    id: string;
    username: string;
    name: string;
    segments: RingBlueprint['segments'];
    votes: number;
    createdAt: string;
  }>
> {
  const raw = await redis.get(blueprintsKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      id: string;
      username: string;
      name: string;
      segments: RingBlueprint['segments'];
      votes: number;
      createdAt: string;
    }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveBlueprints(
  list: Array<{
    id: string;
    username: string;
    name: string;
    segments: RingBlueprint['segments'];
    votes: number;
    createdAt: string;
  }>
): Promise<void> {
  await redis.set(blueprintsKey(), JSON.stringify(list.slice(0, MAX_BLUEPRINTS)));
}

function computeStreak(
  lastPlayDate: string | undefined,
  currentStreak: number,
  dateKey: string
): { streak: number; todayPlayed: boolean } {
  if (!lastPlayDate) return { streak: 0, todayPlayed: false };
  if (lastPlayDate === dateKey) return { streak: currentStreak, todayPlayed: true };

  const last = new Date(`${lastPlayDate}T00:00:00.000Z`);
  const today = new Date(`${dateKey}T00:00:00.000Z`);
  const diffDays = Math.round((today.getTime() - last.getTime()) / 86_400_000);

  if (diffDays === 1) return { streak: currentStreak, todayPlayed: false };
  return { streak: 0, todayPlayed: false };
}

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required but missing from context' },
      400
    );
  }

  try {
    const username = await getUsername();
    const dateKey = utcDateKey();
    const seed = dailySeed(dateKey);

    const [pbRaw, dailyRaw, lastPlay, streakRaw, leaderboard, blueprints, playersRaw] =
      await Promise.all([
        redis.get(`${userKey(username)}:pb`),
        redis.get(`${userKey(username)}:daily:${dateKey}`),
        redis.get(`${userKey(username)}:lastPlay`),
        redis.get(`${userKey(username)}:streak`),
        loadLeaderboard(dateKey),
        loadBlueprints(),
        redis.get(`players:${dateKey}`),
      ]);

    const streakNum = streakRaw ? parseInt(streakRaw, 10) : 0;
    const { streak, todayPlayed } = computeStreak(
      lastPlay ?? undefined,
      Number.isFinite(streakNum) ? streakNum : 0,
      dateKey
    );

    const communityBlueprints: RingBlueprint[] = blueprints
      .slice()
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 8)
      .map((b) => ({ segments: b.segments }));

    return c.json<InitResponse>({
      type: 'init',
      postId,
      username,
      dateKey,
      dailySeed: seed,
      personalBest: pbRaw ? parseInt(pbRaw, 10) || 0 : 0,
      dailyBest: dailyRaw ? parseInt(dailyRaw, 10) || 0 : 0,
      streak,
      todayPlayed,
      leaderboard,
      communityBlueprints,
      playersToday: playersRaw ? parseInt(playersRaw, 10) || 0 : 0,
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const message =
      error instanceof Error
        ? `Initialization failed: ${error.message}`
        : 'Unknown error during initialization';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/score', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  try {
    const body = await c.req.json<SubmitScoreRequest>();
    const depth = Math.floor(Number(body.depth));
    const mode = body.mode === 'endless' ? 'endless' : 'daily';
    const dateKey = typeof body.dateKey === 'string' ? body.dateKey : utcDateKey();

    if (!Number.isFinite(depth) || depth < 0 || depth > 500) {
      return c.json<ErrorResponse>({ status: 'error', message: 'Invalid depth' }, 400);
    }

    const username = await getUsername();
    const uk = userKey(username);

    const [pbRaw, dailyRaw, lastPlay, streakRaw] = await Promise.all([
      redis.get(`${uk}:pb`),
      redis.get(`${uk}:daily:${dateKey}`),
      redis.get(`${uk}:lastPlay`),
      redis.get(`${uk}:streak`),
    ]);

    const personalBest = pbRaw ? parseInt(pbRaw, 10) || 0 : 0;
    const dailyBest = dailyRaw ? parseInt(dailyRaw, 10) || 0 : 0;
    const prevStreak = streakRaw ? parseInt(streakRaw, 10) || 0 : 0;

    const isNewPersonalBest = depth > personalBest;
    const isNewDailyBest = depth > dailyBest;

    let streak = prevStreak;
    if (lastPlay !== dateKey) {
      const { streak: base } = computeStreak(lastPlay ?? undefined, prevStreak, dateKey);
      streak = base + 1;
      await redis.set(`${uk}:lastPlay`, dateKey);
      await redis.set(`${uk}:streak`, String(streak));
      await redis.incrBy(`players:${dateKey}`, 1);
    }

    if (isNewPersonalBest) await redis.set(`${uk}:pb`, String(depth));
    if (isNewDailyBest) await redis.set(`${uk}:daily:${dateKey}`, String(depth));

    let rank: number | null = null;
    let leaderboard = await loadLeaderboard(dateKey);

    if (mode === 'daily' && depth > 0) {
      const withoutUser = leaderboard.filter((e) => e.username !== username);
      withoutUser.push({ username, depth, mode: 'daily' });
      withoutUser.sort((a, b) => b.depth - a.depth);
      leaderboard = withoutUser.slice(0, MAX_LEADERBOARD);
      await saveLeaderboard(dateKey, leaderboard);
      const idx = leaderboard.findIndex((e) => e.username === username);
      rank = idx >= 0 ? idx + 1 : null;
    }

    return c.json<SubmitScoreResponse>({
      type: 'score',
      personalBest: Math.max(personalBest, depth),
      dailyBest: Math.max(dailyBest, depth),
      streak,
      isNewPersonalBest,
      isNewDailyBest,
      rank,
      leaderboard,
    });
  } catch (error) {
    console.error('API Score Error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to submit score' }, 400);
  }
});

api.get('/blueprints', async (c) => {
  try {
    const list = await loadBlueprints();
    list.sort((a, b) => b.votes - a.votes);
    return c.json<BlueprintListResponse>({
      type: 'blueprints',
      blueprints: list.map(({ id, username, name, segments, votes }) => ({
        id,
        username,
        name,
        segments,
        votes,
      })),
    });
  } catch (error) {
    console.error('API Blueprints Error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to load blueprints' }, 400);
  }
});

api.post('/blueprint', async (c) => {
  try {
    const body = await c.req.json<SubmitBlueprintRequest>();
    if (!isValidBlueprint(body.segments)) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Blueprint needs 8 segments with at least one gap and one safe pad',
        },
        400
      );
    }

    const username = await getUsername();
    const list = await loadBlueprints();
    const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const name =
      typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 24)
        : `${username}'s ring`;

    list.unshift({
      id,
      username,
      name,
      segments: body.segments,
      votes: 1,
      createdAt: new Date().toISOString(),
    });

    await saveBlueprints(list);

    return c.json<SubmitBlueprintResponse>({
      type: 'blueprint',
      id,
      message: 'Blueprint forged — it may appear in community towers!',
    });
  } catch (error) {
    console.error('API Blueprint Error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to submit blueprint' }, 400);
  }
});

api.post('/blueprint/vote', async (c) => {
  try {
    const body = await c.req.json<VoteBlueprintRequest>();
    if (!body.id) {
      return c.json<ErrorResponse>({ status: 'error', message: 'Missing blueprint id' }, 400);
    }

    const username = await getUsername();
    const voteKey = `vote:${username}:${body.id}`;
    const already = await redis.get(voteKey);
    if (already) {
      const list = await loadBlueprints();
      const found = list.find((b) => b.id === body.id);
      return c.json<VoteBlueprintResponse>({
        type: 'vote',
        id: body.id,
        votes: found?.votes ?? 0,
      });
    }

    const list = await loadBlueprints();
    const target = list.find((b) => b.id === body.id);
    if (!target) {
      return c.json<ErrorResponse>({ status: 'error', message: 'Blueprint not found' }, 404);
    }

    target.votes += 1;
    await saveBlueprints(list);
    await redis.set(voteKey, '1');

    return c.json<VoteBlueprintResponse>({
      type: 'vote',
      id: body.id,
      votes: target.votes,
    });
  } catch (error) {
    console.error('API Vote Error:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'Failed to vote' }, 400);
  }
});
