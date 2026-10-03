/** Shared title treatment; group names wrap only between complete member names. */
export function CardEntranceNameplate({ name }: { name: string }) {
  const members = name.split('&');
  return (
    <div className="card-entrance-name" aria-label={name}>
      <svg
        className="card-entrance-name-frame"
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="card-entrance-name-panel" d="M14 1H386L399 14V86L386 99H14L1 86V14Z" />
        <path className="card-entrance-name-inset" d="M28 8H372M28 92H372" />
      </svg>
      <i className="card-entrance-name-jewel card-entrance-name-jewel--left" aria-hidden="true" />
      <span className="card-entrance-card-name" aria-hidden="true">
        {members.map((member, index) => (
          <span className="card-entrance-name-member" key={member}>
            {index > 0 && <span className="card-entrance-name-join">&amp;</span>}
            <span>{member}</span>
          </span>
        ))}
      </span>
      <i className="card-entrance-name-jewel card-entrance-name-jewel--right" aria-hidden="true" />
    </div>
  );
}
