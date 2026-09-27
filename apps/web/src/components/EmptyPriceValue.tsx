/** Display-only placeholder. Missing quotes remain null in financial calculations. */
export function EmptyPriceValue() {
  return (
    <span
      title="Waiting for verified price data"
      aria-label="0, placeholder while waiting for verified price data"
    >
      0
    </span>
  );
}
