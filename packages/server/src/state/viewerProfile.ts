import {
  listKey,
  profileUrl,
  readViewerKey,
  userKey,
  viewerKey,
  type AppConfig,
  type ChatEvent,
  type LeaderboardEntry,
  type Platform,
  type StreamEvent,
  type StreamUser,
  type ViewerProfile,
} from '@streaming/shared';
import type { AvatarStore } from './avatars.js';
import type { KnownUser, UserDirectory } from './directory.js';
import type { SessionState } from './session.js';
import { trustSubject, type TrustTracker } from './trust.js';

/** What a profile is assembled from. */
export interface ViewerProfileSources {
  config: AppConfig;
  directory: UserDirectory;
  session: SessionState;
  trust: TrustTracker;
  avatars: AvatarStore;
  /** Recent events, oldest first. Their latest messages fill the card. */
  history: readonly StreamEvent[];
}

/** How many of a viewer's latest messages the card lists. */
const RECENT_MESSAGES = 5;

/** What this server has on one viewer, before any of it is scored or shaped. */
interface FoundViewer {
  key: string;
  platform: Platform;
  handle: string;
  known: KnownUser | undefined;
  live: LeaderboardEntry | undefined;
  /** Their chat lines still in the recent history, oldest first. */
  chats: ChatEvent[];
  /** The newest account details seen for them, live or in history. */
  user: StreamUser | null;
  username: string;
  /** The platform's own id for them, or empty when none was ever seen. */
  userId: string;
}

/** Finds a viewer by key, or null for someone this server has no record of. */
function findViewer(
  reference: string,
  { directory, session, history }: Pick<ViewerProfileSources, 'directory' | 'session' | 'history'>,
): FoundViewer | null {
  const { platform, handle } = readViewerKey(reference);
  const key = viewerKey(platform, handle);
  const known = directory.get(key);
  const live = session.findByHandle(platform, handle);

  const chats = history.filter(
    (event): event is ChatEvent => event.type === 'chat' && userKey(event.user) === key,
  );
  const user = live?.user ?? chats[chats.length - 1]?.user ?? null;
  if (!known && !user) return null;

  return {
    key,
    platform,
    handle,
    known,
    live,
    chats,
    user,
    username: known?.username ?? handle,
    userId: user?.userId || known?.userId || '',
  };
}

/**
 * The public page for a viewer on their platform, or null when there is none
 * or the viewer is unknown. Built from the stored record; nothing about the
 * link comes from the caller.
 */
export function viewerProfileUrl(
  reference: string,
  sources: Pick<ViewerProfileSources, 'directory' | 'session' | 'history'>,
): string | null {
  const viewer = findViewer(reference, sources);
  return viewer ? profileUrl(viewer.platform, viewer.username, viewer.userId) : null;
}

/**
 * Everything the chat panel shows when you click a viewer, or null for
 * someone this server has no record of.
 */
export function buildViewerProfile(
  reference: string,
  sources: ViewerProfileSources,
): ViewerProfile | null {
  const { config, trust, avatars } = sources;
  const viewer = findViewer(reference, sources);
  if (!viewer) return null;

  const { key, platform, handle, known, live, chats, user, username, userId } = viewer;
  const subject = trustSubject(key, user, known, config.users);
  const thisStream = trust.sessionFor(key);

  return {
    key,
    platform,
    username,
    displayName: user?.nickname || known?.displayName || handle,
    avatarUrl: avatars.publicPath(username) ?? user?.avatarUrl ?? known?.avatarUrl ?? null,
    profileUrl: profileUrl(platform, username, userId),
    trusted: subject.onTrustedList,
    muted: config.users.penaltyBox.some((entry) => listKey(entry.username) === key),
    moderator: subject.isModerator,
    subscriber: subject.isSubscriber,
    follower: subject.isFollower,
    verified: subject.isVerified,
    followerCount: user?.followerCount ?? 0,
    trust: trust.score(subject, config.trust),
    session: {
      messages: live?.comments ?? 0,
      gifts: live?.gifts ?? 0,
      diamonds: live?.diamonds ?? 0,
      likes: live?.likes ?? 0,
      shares: live?.shares ?? 0,
      filtered: thisStream.filtered,
      held: thisStream.held,
      firstSeen: thisStream.firstSeen,
    },
    lifetime: known
      ? {
          firstSeen: known.firstSeen,
          lastSeen: known.lastSeen,
          daysSeen: known.daysSeen ?? 1,
          messages: known.messages,
          gifts: known.gifts ?? 0,
          diamonds: known.diamonds ?? 0,
          follows: known.follows ?? 0,
          strikes: known.strikes,
        }
      : null,
    recent: chats
      .slice(-RECENT_MESSAGES)
      .reverse()
      .map((event) => ({
        ts: event.ts,
        text: event.redacted ? '[removed by filter]' : event.text,
        filtered: event.filtered,
        severity: event.filterSeverity,
        held: event.trust?.held ?? null,
      })),
  };
}
