interface Props {
  severity: number;
  size?: number;
}

/**
 * Severity as rings on a radar scope: one lit ring per severity point,
 * counted from the outside in, so a 5 reads as a fully lit target.
 */
export function RadarGlyph({ severity, size = 56 }: Props) {
  const rings = [26, 21, 16, 11, 6];
  return (
    <svg
      className="radar-glyph"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role="img"
      aria-label={`Severity ${severity} of 5`}
    >
      {rings.map((r, i) => (
        <circle
          key={r}
          cx="28"
          cy="28"
          r={r}
          className={i < severity ? "ring ring-on" : "ring"}
        />
      ))}
      <line x1="28" y1="28" x2="28" y2="2" className="sweep" />
      <circle cx="28" cy="28" r="2.5" className="blip" />
    </svg>
  );
}
