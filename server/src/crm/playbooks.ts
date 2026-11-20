/**
 * Playbooks: ready-made CRM setups per type of venue (GoHighLevel calls these "snapshots").
 * Applying one sets the loyalty program, tiers, auto-tags and automations in one click, so a
 * non-technical owner starts with a proven setup and only adjusts numbers.
 */
import type { AutomationDef, BusinessType, CrmSettings, TagRule, Tier } from './engine.js';

const BASE: Omit<CrmSettings, 'businessType' | 'playbook' | 'loyalty' | 'tiers' | 'tagRules' | 'categories'> = {
  senderName: 'AIManager',
  consentText: 'Yes, send me news, offers and rewards from {{business}} by SMS/Viber. I can reply STOP anytime. My data is handled under the Data Privacy Act of 2012.',
  consentVersion: 'v1',
  quietHours: { start: 21, end: 9 },
  holdoutPct: 10,
  attributionDays: 14,
  dayStartHour: 6,
  costPerSms: 0.56,
  retentionDays: 1095,
};

const COMMON_TAGS: TagRule[] = [
  { tag: 'Regular', description: '4+ visits in the last 90 days', when: [{ field: 'visits90', op: 'gte', value: 4 }] },
  { tag: 'Lapsed', description: '3+ visits but none in 60 days', when: [{ field: 'visits', op: 'gte', value: 3 }, { field: 'daysSinceLastVisit', op: 'gte', value: 60 }] },
  { tag: 'Birthday soon', description: 'Birthday within 14 days', when: [{ field: 'daysToBirthday', op: 'lte', value: 14 }] },
  { tag: 'First-timer', description: 'Exactly one visit', when: [{ field: 'visits', op: 'eq', value: 1 }] },
];

const NIGHTCLUB_TIERS: Tier[] = [
  { name: 'Member', minSpend365: 0, multiplier: 1, perks: 'Points on every bill' },
  { name: 'Silver', minSpend365: 30_000, multiplier: 1.25, perks: 'Priority entry, birthday bottle discount' },
  { name: 'Gold', minSpend365: 100_000, multiplier: 1.5, perks: 'Guaranteed table on request, free entry for 3 guests' },
  { name: 'Black', minSpend365: 300_000, multiplier: 2, perks: 'Named VIP host, Ultra VIP access, complimentary bottle per quarter' },
];
const CAFE_TIERS: Tier[] = [
  { name: 'Member', minSpend365: 0, multiplier: 1, perks: 'Stamps on every purchase' },
  { name: 'Regular', minSpend365: 8_000, multiplier: 1.25, perks: 'Free size upgrade' },
  { name: 'Insider', minSpend365: 25_000, multiplier: 1.5, perks: 'Free drink every month, first taste of new menu' },
];

export interface Playbook {
  key: string; name: string; summary: string; businessTypes: BusinessType[];
  settings: Pick<CrmSettings, 'loyalty' | 'tiers' | 'tagRules' | 'categories'>;
  automations: AutomationDef[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'nightclub_vip', name: 'Nightclub — VIP guest management', businessTypes: ['nightclub', 'bar'],
    summary: 'High-touch: recognise big spenders at the door, track tables vs minimum consumable, credit promoters and VIP hosts, win back VIPs who go quiet.',
    settings: {
      categories: ['bottle', 'table', 'cocktails', 'beer', 'shisha', 'food', 'ladies drink', 'champagne'],
      loyalty: {
        enabled: true, name: 'MDC Rewards', earn: { kind: 'spend', pesosPerPoint: 100 }, welcomePoints: 20, birthdayPoints: 100, expiryDays: 365,
        rewards: [
          { key: 'free_entry', name: 'Free entry for 2', points: 50, kind: 'free_item', value: 600, item: 'Entrance x2' },
          { key: 'bucket', name: 'Free beer bucket', points: 150, kind: 'free_item', value: 1200, item: 'Beer bucket' },
          { key: 'bottle_off', name: '₱3,000 off a bottle', points: 300, kind: 'amount_off', value: 3000 },
          { key: 'champagne', name: 'Free champagne bottle', points: 800, kind: 'free_item', value: 8000, item: 'Champagne' },
        ],
      },
      tiers: NIGHTCLUB_TIERS,
      tagRules: [
        { tag: 'VIP', description: '₱100k+ in the last 12 months', when: [{ field: 'spend365', op: 'gte', value: 100_000 }] },
        { tag: 'Big spender', description: 'A single night of ₱25k+', when: [{ field: 'maxSpend', op: 'gte', value: 25_000 }] },
        { tag: 'Bottle buyer', description: 'Bottle on 50%+ of visits', when: [{ field: 'cat:bottle', op: 'gte', value: 50 }] },
        { tag: 'Shisha lover', description: 'Shisha on 50%+ of visits', when: [{ field: 'cat:shisha', op: 'gte', value: 50 }] },
        { tag: 'No-show risk', description: '2+ no-shows on reservations', when: [{ field: 'noShows', op: 'gte', value: 2 }] },
        ...COMMON_TAGS,
      ],
    },
    automations: [
      { key: 'welcome', name: 'Thank you after the first night', trigger: 'welcome', enabled: true, channel: 'sms', days: 1, filter: {}, template: 'Hi {{firstName}}, thanks for partying with us! You have {{points}} points. Show this number at the bar next time to earn more.' },
      { key: 'vip_thanks', name: 'VIP thank-you (next day)', trigger: 'post_visit', enabled: true, channel: 'sms', days: 1, filter: { tags: ['VIP'] }, template: 'Hi {{firstName}}, thank you for last night. Your {{tier}} perks are waiting — reply to book your table for the weekend.' },
      { key: 'birthday', name: 'Birthday table invite', trigger: 'birthday', enabled: true, channel: 'sms', days: 7, filter: {}, bonusPoints: 100, template: 'Happy birthday week, {{firstName}}! We added 100 bonus points ({{points}} total). Celebrate with us — reply BOOK for a birthday table.' },
      { key: 'vip_overdue', name: 'VIP gone quiet', trigger: 'vip_overdue', enabled: true, channel: 'sms', days: 0, filter: { minSpend365: 30_000 }, template: 'Hi {{firstName}}, we miss you at the club! Your table is ready any night this week — reply to reserve.' },
      { key: 'winback', name: 'Win-back after 45 days', trigger: 'winback', enabled: false, channel: 'sms', days: 45, filter: {}, bonusPoints: 50, template: 'Hi {{firstName}}, it has been a while! Here are 50 bonus points ({{points}} total) — valid on your next visit.' },
      { key: 'reward_ready', name: 'Reward unlocked', trigger: 'reward_ready', enabled: true, channel: 'sms', days: 0, filter: {}, template: 'Hi {{firstName}}, you have {{points}} points — enough for: {{reward}}. Claim it on your next visit.' },
    ],
  },
  {
    key: 'cafe_loyalty', name: 'Café — purchase-based loyalty', businessTypes: ['cafe', 'restaurant', 'retail'],
    summary: 'High-frequency: phone number at the counter, a stamp per visit, free drink after 9, nudges when a regular skips their usual rhythm. Zero training needed.',
    settings: {
      categories: ['coffee', 'non-coffee', 'pastry', 'meal', 'beans'],
      loyalty: {
        enabled: true, name: 'Stamp card', earn: { kind: 'visit', points: 1, minSpend: 120 }, welcomePoints: 1, birthdayPoints: 3, expiryDays: 180,
        rewards: [
          { key: 'pastry', name: 'Free pastry', points: 5, kind: 'free_item', value: 120, item: 'Pastry' },
          { key: 'drink', name: 'Free drink of choice', points: 9, kind: 'free_item', value: 180, item: 'Any drink' },
        ],
      },
      tiers: CAFE_TIERS,
      tagRules: [
        { tag: 'Daily regular', description: '12+ visits in 90 days', when: [{ field: 'visits90', op: 'gte', value: 12 }] },
        { tag: 'Pastry fan', description: 'Pastry on 50%+ of visits', when: [{ field: 'cat:pastry', op: 'gte', value: 50 }] },
        ...COMMON_TAGS,
      ],
    },
    automations: [
      { key: 'welcome', name: 'Welcome + how stamps work', trigger: 'welcome', enabled: true, channel: 'sms', days: 0, filter: {}, template: 'Welcome {{firstName}}! You have {{points}} stamp(s). 9 stamps = a free drink. Just give your number at the counter.' },
      { key: 'reward_ready', name: 'Free drink unlocked', trigger: 'reward_ready', enabled: true, channel: 'sms', days: 0, filter: {}, template: 'Hi {{firstName}}, you have {{points}} stamps — {{reward}} is yours on your next visit!' },
      { key: 'vip_overdue', name: 'Regular skipped their routine', trigger: 'vip_overdue', enabled: true, channel: 'sms', days: 0, filter: { minVisits: 5 }, template: 'Hi {{firstName}}, we have not seen you lately! Your next drink earns double stamps this week.' },
      { key: 'birthday', name: 'Birthday treat', trigger: 'birthday', enabled: true, channel: 'sms', days: 0, filter: {}, bonusPoints: 3, template: 'Happy birthday {{firstName}}! 3 bonus stamps are on us ({{points}} total).' },
      { key: 'winback', name: 'Win-back after 30 days', trigger: 'winback', enabled: false, channel: 'sms', days: 30, filter: {}, template: 'Hi {{firstName}}, your stamp card misses you — {{points}} stamps waiting. See you soon!' },
    ],
  },
  {
    key: 'shisha_lounge', name: 'Shisha lounge — flavour regulars', businessTypes: ['shisha', 'bar'],
    summary: 'In between: spend-based points, remember favourite flavours and seats, invite regulars when a new flavour lands, fill quiet weeknights.',
    settings: {
      categories: ['shisha', 'refill', 'drinks', 'food', 'premium flavour'],
      loyalty: {
        enabled: true, name: 'Lounge points', earn: { kind: 'spend', pesosPerPoint: 50 }, welcomePoints: 10, birthdayPoints: 40, expiryDays: 365,
        rewards: [
          { key: 'refill', name: 'Free head refill', points: 30, kind: 'free_item', value: 250, item: 'Refill' },
          { key: 'shisha', name: 'Free shisha', points: 80, kind: 'free_item', value: 750, item: 'Shisha' },
          { key: 'premium', name: 'Free premium flavour', points: 120, kind: 'free_item', value: 1100, item: 'Premium shisha' },
        ],
      },
      tiers: [
        { name: 'Member', minSpend365: 0, multiplier: 1, perks: 'Points on every bill' },
        { name: 'Lounge regular', minSpend365: 15_000, multiplier: 1.25, perks: 'Reserved favourite seat on weeknights' },
        { name: 'Cloud chaser', minSpend365: 50_000, multiplier: 1.5, perks: 'Free premium flavour monthly, early access to new flavours' },
      ],
      tagRules: [
        { tag: 'Weeknight regular', description: '4+ visits in 90 days', when: [{ field: 'visits90', op: 'gte', value: 4 }] },
        { tag: 'Premium flavour', description: 'Premium flavour on 30%+ of visits', when: [{ field: 'cat:premium flavour', op: 'gte', value: 30 }] },
        ...COMMON_TAGS,
      ],
    },
    automations: [
      { key: 'welcome', name: 'Welcome to the lounge', trigger: 'welcome', enabled: true, channel: 'sms', days: 1, filter: {}, template: 'Hi {{firstName}}, thanks for chilling with us! You have {{points}} points — 30 points = a free refill.' },
      { key: 'reward_ready', name: 'Reward unlocked', trigger: 'reward_ready', enabled: true, channel: 'sms', days: 0, filter: {}, template: 'Hi {{firstName}}, {{points}} points = {{reward}}. Claim it on your next session.' },
      { key: 'vip_overdue', name: 'Regular is overdue', trigger: 'vip_overdue', enabled: true, channel: 'sms', days: 0, filter: { minVisits: 4 }, template: 'Hi {{firstName}}, your favourite seat is free tonight. Double points Mon–Thu this week.' },
      { key: 'birthday', name: 'Birthday shisha', trigger: 'birthday', enabled: true, channel: 'sms', days: 3, filter: {}, bonusPoints: 40, template: 'Happy birthday {{firstName}}! +40 points ({{points}} total) — enough for a free refill on your celebration.' },
    ],
  },
];

export const getPlaybook = (key: string) => PLAYBOOKS.find((p) => p.key === key) ?? null;

export const DEFAULT_CRM: CrmSettings = {
  ...BASE, businessType: 'nightclub', playbook: 'nightclub_vip', ...structuredClone(PLAYBOOKS[0].settings),
};

/** Merge stored (possibly older / partial) CRM settings with defaults. */
export function crmWithDefaults(s: Partial<CrmSettings> | null | undefined): CrmSettings {
  const base = structuredClone(DEFAULT_CRM);
  if (!s) return base;
  return {
    ...base, ...s,
    loyalty: { ...base.loyalty, ...(s.loyalty ?? {}), earn: s.loyalty?.earn ?? base.loyalty.earn, rewards: s.loyalty?.rewards ?? base.loyalty.rewards },
    quietHours: { ...base.quietHours, ...(s.quietHours ?? {}) },
    tiers: s.tiers ?? base.tiers, tagRules: s.tagRules ?? base.tagRules, categories: s.categories ?? base.categories,
  };
}

/** Settings after applying a playbook; numbers the owner tuned outside the playbook (sender name, holdout…) are kept. */
export function applyPlaybook(current: CrmSettings, key: string): { settings: CrmSettings; automations: AutomationDef[] } {
  const p = getPlaybook(key);
  if (!p) throw new Error(`Unknown playbook ${key}`);
  return { settings: { ...current, ...structuredClone(p.settings), playbook: p.key, businessType: p.businessTypes[0] }, automations: structuredClone(p.automations) };
}
