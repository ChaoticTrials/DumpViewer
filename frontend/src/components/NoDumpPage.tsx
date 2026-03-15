interface Props {
  manifestId: string;
}

export default function NoDumpPage({ manifestId }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        gap: 16,
        color: 'var(--text)',
      }}
    >
      <span style={{ fontSize: 48, lineHeight: 1 }}>📭</span>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-h)', margin: '0 0 8px' }}>
          No dump available
        </p>
        <p style={{ fontSize: 13, margin: '0 0 4px', opacity: 0.7 }}>
          There is no dump stored for:
        </p>
        <code
          style={{
            fontSize: 13,
            padding: '2px 8px',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontFamily: 'var(--mono)',
          }}
        >
          {manifestId}
        </code>
      </div>
      <button
        onClick={() => {
          window.location.href = '/';
        }}
        className="upload-btn"
        style={{ marginTop: 8 }}
      >
        Return Home
      </button>
    </div>
  );
}
