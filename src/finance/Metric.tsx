export default function Metric({
  label,
  value,
  note,
  icon,
  testId,
  debt = false,
  onOpen,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  testId: string;
  debt?: boolean;
  onOpen?: () => void;
}) {
  return (
    <article
      className={`card client-metric ${debt ? "client-debt-metric" : ""}`}
    >
      <div>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong data-testid={testId}>{value}</strong>
      <small>{note}</small>
      {onOpen && (
        <button
          className="text-button"
          onClick={onOpen}
          aria-label={`Szczegóły: ${label}`}
        >
          Zobacz szczegóły
        </button>
      )}
    </article>
  );
}
