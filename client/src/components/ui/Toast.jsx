export function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div id="toast">
      {toasts.map(t => (
        <div key={t.id} className="toast-item">{t.message}</div>
      ))}
    </div>
  );
}
