// Recovery values from BO1-Reimagined-master/maps/_gameskill.gsc:
// apply_difficulty_frac_with_func and playerHealthRegen. This is a recovery-only
// option, not a port of the complete mod or a change to the reconstruction rules.
export const GAME_PROFILES = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    label: 'Classic reconstruction',
    description: 'The reconstruction\'s existing gameplay and health recovery.',
    recovery: null,
  }),
  reimagined: Object.freeze({
    id: 'reimagined',
    label: 'Reimagined recovery',
    description: 'Reimagined health recovery only: 2-second normal delay, 4-second critical delay, and 100 health per second.',
    recovery: Object.freeze({
      normalDelay: 2,
      criticalDelay: 4,
      criticalFraction: .2,
      healthPerSecond: 100,
      // Source divides by 1.25; the README's stated 25% reduction differs.
      quickReviveDivisor: 1.25,
    }),
  }),
});

export function resolveGameProfile(id = 'classic') {
  if (!Object.hasOwn(GAME_PROFILES, id)) throw new RangeError('Unknown game profile: ' + id);
  return GAME_PROFILES[id];
}
