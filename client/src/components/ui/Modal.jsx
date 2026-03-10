export function Modal({ open, onClose, title, children, className = '' }) {
  if (!open) return null;
  return (
    <div
      className="overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal ${className}`}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function ModalRow({ children }) {
  return <div className="modal-row">{children}</div>;
}
