// Only explicit passkey interactions register a cancellation callback. Normal
// startup/navigation has no extra session reads, storage writes or subscriptions.
const cancellations = new Set<() => void>();

export function observePasskeyInvalidation(cancel: () => void): () => void {
  cancellations.add(cancel);
  return () => { cancellations.delete(cancel); };
}

export function invalidatePasskeyOperations(): void {
  for (const cancel of cancellations) cancel();
}
