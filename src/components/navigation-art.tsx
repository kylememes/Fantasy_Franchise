const positions: Record<string, [number, number]> = {
  Dashboard: [0, 0],
  Coaching: [1, 0],
  Roster: [2, 0],
  Trades: [0, 1],
  Draft: [1, 1],
  "Game Center": [2, 1],
};
/** Display windows into the approved sheet, preserving the original artwork. */
export function NavigationArt({ name }: { name: string }) {
  const cell = positions[name];
  if (!cell) return null;
  return (
    <span
      aria-hidden="true"
      className="navigation-art"
      style={{
        backgroundPosition: `${-cell[0] * 64}px ${-(cell[1] ? 65 : 14)}px`,
      }}
    />
  );
}
