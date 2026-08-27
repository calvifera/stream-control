import type { StreamEvent } from './events.js';

/**
 * Placeholder values available to TTS templates, alert templates and custom
 * overlay HTML. Everything is a string so templates never render `undefined`.
 */
export type TemplateVars = Record<string, string>;

export function buildTemplateVars(event: StreamEvent, extra: TemplateVars = {}): TemplateVars {
  const user = event.user;
  const vars: TemplateVars = {
    type: event.type,
    username: user?.uniqueId ?? '',
    nickname: user?.nickname ?? user?.uniqueId ?? '',
    avatar: user?.avatarUrl ?? '',
    followerCount: String(user?.followerCount ?? 0),
    badges: (user?.badges ?? []).join(', '),
    message: '',
    gift: '',
    giftImage: '',
    count: '',
    diamonds: '',
    likes: '',
    months: '',
    viewers: '',
    coins: '',
  };

  switch (event.type) {
    case 'chat':
      vars.message = event.displayText ?? event.text;
      break;
    case 'question':
      vars.message = event.text;
      break;
    case 'gift':
      vars.gift = event.giftName;
      vars.giftImage = event.giftImageUrl ?? '';
      vars.count = String(event.repeatCount);
      vars.diamonds = String(event.totalDiamonds);
      break;
    case 'like':
      vars.count = String(event.likeCount);
      vars.likes = String(event.totalLikeCount);
      break;
    case 'follow':
      vars.count = String(event.totalFollowCount);
      break;
    case 'share':
      vars.count = String(event.shareCount);
      break;
    case 'join':
      vars.count = String(event.memberCount);
      break;
    case 'subscribe':
      vars.months = String(event.subMonths);
      break;
    case 'envelope':
      vars.coins = String(event.coins);
      vars.count = String(event.peopleCount);
      break;
    case 'roomStats':
      vars.viewers = String(event.viewerCount);
      break;
    case 'system':
      vars.message = event.text;
      break;
    default:
      break;
  }

  return { ...vars, ...extra };
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replaces `{{name}}` with `vars.name`; unknown names collapse to ''. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => vars[key] ?? '');
}

/** Same as `renderTemplate` but HTML-escapes each substitution. */
export function renderHtmlTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => escapeHtml(vars[key] ?? ''));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
